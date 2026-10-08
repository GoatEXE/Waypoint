import { createHash, timingSafeEqual } from 'node:crypto';
import { publicConfig } from './config.js';
import { badRequest, conflict, forbidden, toErrorResponse, unsupportedMediaType } from './errors.js';
import { normalizeSeatModel, publicSeatsResult } from './podSeats.js';
import { inspectLocalPath } from './github.js';
import { FolderDialog } from './folderDialog.js';
import { podProjectMounts } from './projectMounts.js';

const folderDialog = new FolderDialog();

const NOT_FOUND = { status: 404, body: { error: { code: 'not_found', message: 'Route not found' } } };

export function createHandler({ config, store, organization, docker, hermes, podSeats, podSeatAuth, taskRuns, messaging, seatChat, github, portal, logger }) {
  return createJsonHandler(logger, (request, url) => {
    assertMutationSafety(request);
    return route(request, url, { config, store, organization, docker, hermes, podSeats, podSeatAuth, taskRuns, messaging, seatChat, github, portal, logger });
  });
}

export function createBridgeHandler({ config, store, docker, hermes, podSeats, taskRuns, messaging, github, logger }) {
  return createJsonHandler(logger, async (request, url) => {
    if (request.method !== 'POST' || url.pathname !== '/bridge/tools') return NOT_FOUND;
    assertMutationSafety(request);
    return { body: await bridgeTool(request, { config, store, docker, hermes, podSeats, taskRuns, messaging, github }) };
  });
}

function createJsonHandler(logger, dispatch) {
  return async function handler(request, response) {
    const started = Date.now();
    try {
      const url = new URL(request.url, 'http://waypoint.local');
      const result = await dispatch(request, url);
      sendJson(response, result.status || 200, result.body);
      logger.info('request', { method: request.method, path: url.pathname, status: result.status || 200, ms: Date.now() - started });
    } catch (error) {
      const { status, payload } = toErrorResponse(error);
      sendJson(response, status, payload);
      logger.warn('request_error', { method: request.method, url: request.url, status, code: payload.error.code, ms: Date.now() - started });
    }
  };
}
async function route(request, url, { config, store, organization, docker, hermes, podSeats, podSeatAuth, taskRuns, messaging, seatChat, github, portal, logger }) {
  if (url.pathname === '/hermes-portal' && portal) {
    if (request.method === 'GET') return { body: portal.status() };
    if (request.method === 'DELETE') return { body: await portal.close() };
    if (request.method === 'POST') {
      const body = await readBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'target')) throw badRequest('body must be { target }');
      return { body: await portal.open(body.target) };
    }
  }
  if (url.pathname.startsWith('/github') && github) {
    if (request.method === 'GET' && url.pathname === '/github') return { body: await github.status({ fresh: url.searchParams.get('fresh') === '1' }) };
    if (request.method === 'POST' && url.pathname === '/github/manifest') {
      const body = await readBody(request);
      return { body: github.manifest({ origin: body.origin, owner: body.owner, orgName: (await organization.get())?.name }) };
    }
    if (request.method === 'POST' && url.pathname === '/github/complete') return { body: await github.completeManifest(await readBody(request)) };
    if (request.method === 'DELETE' && url.pathname === '/github') return { body: await github.disconnect() };
  }
  if (request.method === 'POST' && url.pathname === '/folders/pick') return { body: await folderDialog.pick({ start: (await readBody(request)).start }) };
  if (request.method === 'POST' && url.pathname === '/projects/inspect') return { body: await inspectLocalPath((await readBody(request)).localPath) };
  if (request.method === 'GET' && url.pathname === '/healthz') return { body: { ok: true, service: config.serviceName, dryRun: config.dryRun, uptimeSeconds: Math.round(process.uptime()) } };
  if (request.method === 'GET' && url.pathname === '/config') return { body: publicConfig(config) };
  if (request.method === 'GET' && url.pathname === '/organization') return { body: await organization.describe() };
  if (request.method === 'PUT' && url.pathname === '/organization') {
    const { organization: saved, identityChanged } = await organization.update(await readBody(request));
    if (identityChanged) void hermes.refreshCeoIdentity().catch((error) => logger.warn('ceo_identity_refresh_failed', { message: error.message }));
    return { body: { configured: true, organization: saved } };
  }
  if (request.method === 'GET' && url.pathname === '/org-chart') return { body: await messaging.listOrg(url.searchParams.get('query') || '') };
  if (request.method === 'GET' && url.pathname === '/messages') return { body: await messaging.inbox('ceo', { limit: Number(url.searchParams.get('limit') || 50), includeRead: url.searchParams.get('includeRead') === 'true' }) };
  if (request.method === 'POST' && url.pathname === '/messages') return { status: 201, body: await messaging.send('ceo', await readBody(request)) };
  if (request.method === 'POST' && url.pathname === '/messages/ack') return { body: await messaging.acknowledge('ceo', (await readBody(request)).messageId) };
  if (request.method === 'GET' && url.pathname === '/message-deliveries') return { body: await messaging.listDeliveries({ limit: Number(url.searchParams.get('limit') || 100) }) };
  if (request.method === 'POST' && url.pathname === '/message-deliveries/review') {
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['to', 'messageId'].includes(key))) throw badRequest('review requires to and messageId');
    return { body: await messaging.reviewDelivery(body.to, body.messageId) };
  }
  if (request.method === 'GET' && url.pathname === '/hermes/status') return { body: await hermes.status({ nativeAuth: url.searchParams.get('nativeAuth') === 'fresh' ? 'fresh' : 'cached' }) };
  if (request.method === 'GET' && url.pathname === '/hermes/skills') return { body: await hermes.skills() };
  let match = url.pathname.match(/^\/hermes\/skills\/(.+)$/);
  if (request.method === 'GET' && match) return { body: await hermes.skill(decodeRouteParam(match[1])) };
  if (request.method === 'PUT' && match) return { body: await hermes.setSkillEnabled(decodeRouteParam(match[1]), await readBody(request)) };
  if (request.method === 'GET' && url.pathname === '/hermes/ceo/conversation') return { body: await hermes.ceoConversation(url.searchParams.get('threadId') || undefined) };
  if (request.method === 'GET' && url.pathname === '/hermes/ceo/threads') return { body: await ceoThreads(store, hermes) };
  if (request.method === 'POST' && url.pathname === '/hermes/ceo/messages') {
    const body = await readBody(request);
    const threadId = body?.threadId || undefined;
    const context = threadId ? await taskThreadContext(store, threadId) : '';
    return { body: await hermes.sendCeoMessage({ message: body?.message, threadId, context }) };
  }
  if (request.method === 'GET' && url.pathname === '/hermes/model-catalog') return { body: await hermes.modelCatalog(url.searchParams.get('provider') || '', { refresh: url.searchParams.get('refresh') === '1' || url.searchParams.get('refresh') === 'true' }) };
  if (request.method === 'POST' && url.pathname === '/hermes/lifecycle') return { body: await hermes.lifecycle((await readBody(request)).action) };
  if (request.method === 'PUT' && url.pathname === '/hermes/model') return { body: await hermes.saveModel(await readBody(request)) };
  match = url.pathname.match(/^\/hermes\/providers\/([^/]+)\/api-key$/);
  if (request.method === 'PUT' && match) return { body: await hermes.saveApiKey(match[1], await readBody(request)) };
  match = url.pathname.match(/^\/hermes\/providers\/([^/]+)\/login$/);
  if (request.method === 'POST' && match) return { status: 202, body: await hermes.startLogin(match[1], await readBody(request)) };
  match = url.pathname.match(/^\/hermes\/providers\/([^/]+)\/login\/([^/]+)$/);
  if (request.method === 'GET' && match) return { body: hermes.getLogin(match[1], match[2]) };
  if (request.method === 'DELETE' && match) return { body: hermes.cancelLogin(match[1], match[2]) };
  match = url.pathname.match(/^\/hermes\/providers\/([^/]+)\/login\/([^/]+)\/code$/);
  if (request.method === 'POST' && match) return { body: hermes.submitLoginCode(match[1], match[2], await readBody(request)) };
  if (request.method === 'POST' && url.pathname === '/pod-templates') return { status: 201, body: await store.createTemplate(await readBody(request)) };
  match = url.pathname.match(/^\/pod-templates\/([^/]+)\/clone$/);
  if (request.method === 'POST' && match) return { status: 201, body: await store.cloneTemplate(match[1], await readBody(request), ({ podId, podName }) => docker.startPlan({ podId, podName })) };
  match = url.pathname.match(/^\/pod-instances\/([^/]+)$/);
  if (request.method === 'GET' && match) return { body: await store.getInstance(match[1], { dockerPlanFactory: ({ podId, podName }) => docker.startPlan({ podId, podName }) }) };
  match = url.pathname.match(/^\/pod-instances\/([^/]+)\/lifecycle$/);
  if (request.method === 'POST' && match) {
    const body = await readBody(request);
    let instance = await store.getInstance(match[1], { dockerPlanFactory: ({ podId, podName }) => docker.startPlan({ podId, podName }) });
    if (body.action === 'start' && !config.dryRun) instance = await defaultPodModelFromCeo(store, hermes, instance);
    const result = await docker.lifecycle(instance, body.action, { projectMounts: podProjectMounts(await store.listProjects(), instance.id) });
    await store.recordLifecycle(instance.id, result, ({ podId, podName }) => docker.startPlan({ podId, podName }));
    return { body: result };
  }
  match = url.pathname.match(/^\/pod-instances\/([^/]+)\/seats\/status$/);
  if (request.method === 'GET' && match) {
    const seatIds = url.searchParams.get('seatIds');
    const options = { seatIds: seatIds == null ? undefined : seatIds.split(',').map((id) => id.trim()).filter(Boolean), checkAuth: url.searchParams.get('auth') !== 'skip' };
    return { body: await podSeatsAction(store, podSeats, match[1], 'inspect', options) };
  }
  match = url.pathname.match(/^\/pod-instances\/([^/]+)\/seats\/provision$/);
  if (request.method === 'POST' && match) {
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('body must be an object');
    const unsupported = Object.keys(body).filter((key) => key !== 'seatIds');
    if (unsupported.length) throw badRequest('seat provisioning accepts only seatIds; models come from the pod template', { fields: unsupported.slice(0, 10).map((key) => key.slice(0, 64)) });
    const instance = await store.getInstance(match[1]);
    const result = await podSeatsAction(store, podSeats, match[1], 'provision', { seatIds: body.seatIds });
    const readyProfiles = result.seats.filter((seat) => seat.profile?.state === 'ready').map((seat) => seat.seatId);
    if (result.executed && readyProfiles.length && messaging) await messaging.installSeatTools(instance, readyProfiles, podSeats);
    return { body: result };
  }
  match = url.pathname.match(/^\/pod-instances\/([^/]+)\/seats\/([^/]+)\/model$/);
  if (request.method === 'PUT' && match) {

    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.hasOwn(body, 'model')) throw badRequest('body must be { model }');
    const unsupported = Object.keys(body).filter((key) => key !== 'model');
    if (unsupported.length) throw badRequest('seat model update accepts only model', { fields: unsupported.slice(0, 10).map((key) => key.slice(0, 64)) });
    return { body: await store.setSeatModel(match[1], decodeRouteParam(match[2]), body.model) };
  }
  match = url.pathname.match(/^\/pod-instances\/([^/]+)\/seats\/([^/]+)\/providers\/([^/]+)\/login$/);
  if (request.method === 'POST' && match) return { status: 202, body: await podSeatAuthStart(store, podSeatAuth, match[1], decodeRouteParam(match[2]), decodeRouteParam(match[3]), await readBody(request)) };
  match = url.pathname.match(/^\/pod-instances\/([^/]+)\/seats\/([^/]+)\/providers\/([^/]+)\/login\/([^/]+)$/);
  if (request.method === 'GET' && match) return { body: podSeatAuth.getLogin(match[1], decodeRouteParam(match[2]), decodeRouteParam(match[3]), decodeRouteParam(match[4])) };
  if (request.method === 'DELETE' && match) return { body: podSeatAuth.cancelLogin(match[1], decodeRouteParam(match[2]), decodeRouteParam(match[3]), decodeRouteParam(match[4])) };
  match = url.pathname.match(/^\/pod-instances\/([^/]+)\/seats\/([^/]+)\/providers\/([^/]+)\/login\/([^/]+)\/code$/);
  if (request.method === 'POST' && match) return { body: podSeatAuth.submitLoginCode(match[1], decodeRouteParam(match[2]), decodeRouteParam(match[3]), decodeRouteParam(match[4]), await readBody(request)) };
  match = url.pathname.match(/^\/pod-instances\/([^/]+)\/seats\/([^/]+)\/providers\/([^/]+)\/api-key$/);
  if (request.method === 'PUT' && match) return { body: await podSeatAuthSaveKey(store, podSeatAuth, match[1], decodeRouteParam(match[2]), decodeRouteParam(match[3]), await readBody(request)) };
  match = url.pathname.match(/^\/pod-instances\/([^/]+)\/seats\/([^/]+)\/conversation$/);
  if (request.method === 'GET' && match && seatChat) return { body: await seatChat.conversation(decodeRouteParam(match[1]), decodeRouteParam(match[2])) };
  match = url.pathname.match(/^\/pod-instances\/([^/]+)\/seats\/([^/]+)\/messages$/);
  if (request.method === 'POST' && match && seatChat) return { body: await seatChat.send(decodeRouteParam(match[1]), decodeRouteParam(match[2]), await readBody(request)) };
  if (request.method === 'GET' && url.pathname === '/missions') return { body: { missions: await store.listMissions() } };
  if (request.method === 'POST' && url.pathname === '/missions') {
    const { created, mission } = await store.createMission(await readBody(request), { source: 'app' });
    return { status: created ? 201 : 200, body: mission };
  }
  match = url.pathname.match(/^\/missions\/([^/]+)$/);
  if (request.method === 'GET' && match) return { body: await store.getMission(match[1]) };
  if (request.method === 'DELETE' && match) return { body: await store.deleteMission(match[1]) };
  match = url.pathname.match(/^\/missions\/([^/]+)\/links$/);
  if (request.method === 'POST' && match) return { body: await store.linkMission(match[1], await readBody(request)) };
  if (request.method === 'POST' && url.pathname === '/tasks') return { status: 201, body: await store.createTask(await readBody(request)) };
  if (request.method === 'GET' && url.pathname === '/tasks') return { body: { tasks: await store.listTasks() } };
  if (request.method === 'GET' && url.pathname === '/projects') return { body: { projects: await store.listProjects() } };
  if (request.method === 'POST' && url.pathname === '/projects') {
    const project = await store.createProject(await withDetectedRepo(await readBody(request)));
    const pods = await applyProjectMounts(null, project, { config, store, docker, taskRuns, logger });
    return { status: 201, body: { ...project, pods, toolsInstalled: await installGithubTools(project.githubSeats, [], { config, store, podSeats, messaging, logger }) } };
  }
  match = url.pathname.match(/^\/projects\/([^/]+)$/);
  if (request.method === 'GET' && match) return { body: await store.getProject(decodeRouteParam(match[1])) };
  if (request.method === 'DELETE' && match) return { body: await store.deleteProject(decodeRouteParam(match[1])) };
  if (request.method === 'PATCH' && match) {
    const before = await store.getProject(decodeRouteParam(match[1]));
    const project = await store.updateProject(before.id, await withDetectedRepo(await readBody(request)));
    const pods = await applyProjectMounts(before, project, { config, store, docker, taskRuns, logger });
    return { body: { ...project, pods, toolsInstalled: await installGithubTools(project.githubSeats, before.githubSeats || [], { config, store, podSeats, messaging, logger }) } };
  }
  match = url.pathname.match(/^\/tasks\/([^/]+)$/);
  if (request.method === 'GET' && match) {
    const task = await store.getTaskView(decodeRouteParam(match[1]));
    return { body: { ...task, liveActivity: taskRuns.liveActivity(task.id) } };
  }
  if (request.method === 'PATCH' && match) return { body: await store.updateTask(decodeRouteParam(match[1]), await readBody(request)) };
  match = url.pathname.match(/^\/tasks\/([^/]+)\/run$/);
  if (request.method === 'POST' && match) {
    const result = await taskRuns.start(await store.resolveTaskId(decodeRouteParam(match[1])), await readBody(request));
    return { status: result.dryRun ? 200 : 202, body: result };
  }
  match = url.pathname.match(/^\/tasks\/([^/]+)\/messages$/);
  if (request.method === 'GET' && match) {
    const taskId = await store.resolveTaskId(decodeRouteParam(match[1]));
    return { body: { messages: messaging ? await messaging.listTaskMessages(taskId) : [] } };
  }
  match = url.pathname.match(/^\/tasks\/([^/]+)\/manual-retry$/);
  if (request.method === 'POST' && match) {
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.reviewed !== true || Object.keys(body).some((key) => key !== 'reviewed')) throw badRequest('manual retry requires { reviewed: true }');
    const result = await taskRuns.start(await store.resolveTaskId(decodeRouteParam(match[1])), {}, { manualRetry: true });
    return { status: result.dryRun ? 200 : 202, body: result };
  }
  return NOT_FOUND;
}
async function bridgeTool(request, { config, store, docker, hermes, podSeats, taskRuns, messaging, github }) {
  const body = await readBody(request);
  const tool = String(body.tool || '');
  const args = body.args || {};
  if (['github_token', 'github_api'].includes(tool)) return seatGithubTool(request, tool, args, { store, messaging, github });
  if (['org_chart', 'inbox', 'outbox', 'send_message', 'ack_message'].includes(tool)) {
    if (!messaging) throw forbidden('Waypoint messaging is unavailable');
    const actor = await messaging.actorFromAuthorization(request.headers.authorization);
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw badRequest('args must be an object');
    if (tool === 'org_chart') {
      assertBridgeFields(args, ['query']);
      return messaging.listOrg(args.query || '');
    }
    if (tool === 'inbox') {
      assertBridgeFields(args, ['limit', 'includeRead']);
      return messaging.inbox(actor, { limit: args.limit ?? 50, includeRead: args.includeRead ?? false });
    }
    if (tool === 'outbox') {
      assertBridgeFields(args, ['limit', 'taskId']);
      return messaging.outbox(actor, { limit: args.limit ?? 20, taskId: args.taskId || undefined });
    }
    if (tool === 'ack_message') {
      assertBridgeFields(args, ['messageId']);
      return messaging.acknowledge(actor, args.messageId);
    }
    assertBridgeFields(args, ['to', 'text', 'taskId']);
    const liveThread = actor === 'ceo' ? hermes.liveTurn?.threadId : null;
    const sent = await messaging.send(actor, !args.taskId && liveThread && liveThread !== 'general' ? { ...args, taskId: liveThread } : args, { bridge: true });
    if (actor === 'ceo') hermes.recordCeoAction?.('send_message', `to ${String(args.to || '').slice(0, 80)}`);
    return sent;
  }
  if (!bearerMatches(request.headers.authorization, config.bridge.token)) throw forbidden('Waypoint bridge token is required');

  if (hermes.mailboxTurnInFlight) throw forbidden('CEO control tools are unavailable during a peer-message turn');
  let result;
  try { result = await ceoControlTool(tool, args, { config, store, docker, hermes, podSeats, taskRuns, messaging }); }
  catch (error) {
    if (tool !== 'health') hermes.recordCeoAction?.(tool, String(error.message || 'failed'), 'error');
    throw error;
  }
  if (tool !== 'health') hermes.recordCeoAction?.(tool, actionSummary(tool, args, result));
  return result;
}
async function ceoControlTool(tool, args, { config, store, docker, hermes, podSeats, taskRuns, messaging }) {
  if (tool === 'health') return { ok: true, service: config.serviceName };
  if (tool === 'create_template') return store.createTemplate(args);
  if (tool === 'clone_template') return store.cloneTemplate(String(args.templateId || ''), args, ({ podId, podName }) => docker.startPlan({ podId, podName }));
  if (tool === 'pod_status') return bridgePodLifecycle(config, store, docker, hermes, podSeats, messaging, String(args.podId || ''), 'status');
  if (tool === 'pod_start') return bridgePodLifecycle(config, store, docker, hermes, podSeats, messaging, String(args.podId || ''), 'start');
  if (tool === 'pod_stop') return bridgePodLifecycle(config, store, docker, hermes, podSeats, messaging, String(args.podId || ''), 'stop');
  if (tool === 'create_task') return store.createTask(args, { actor: 'ceo' });
  if (tool === 'update_task') {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw badRequest('args must be an object');
    const { taskId, ...fields } = args;
    return store.updateTask(String(taskId || ''), fields, { actor: 'ceo' });
  }
  if (tool === 'list_tasks') return { tasks: await store.listTasks() };
  if (tool === 'list_projects') return { projects: await store.listProjects() };
  if (tool === 'create_project') return store.createProject(args);
  if (tool === 'create_mission') return store.createMission(args, { source: 'ceo' });
  if (tool === 'link_mission') return store.linkMission(String(args.missionId || ''), args);
  if (tool === 'list_missions') return { missions: await store.listMissions() };
  if (tool === 'run_task') {

    const { plan: _plan, ...summary } = await taskRuns.start(await store.resolveTaskId(bridgeTaskId(args)), {});
    return summary;
  }
  if (tool === 'task_status') return taskRuns.status(await store.resolveTaskId(bridgeTaskId(args)));
  throw badRequest('unsupported bridge tool', { tool });
}
async function ceoThreads(store, hermes) {
  const { threads, busyThreadId } = await hermes.listCeoThreads();
  const tasks = new Map((await store.listTasks()).map((task) => [task.id, task]));
  return {
    busyThreadId,
    threads: threads.map((thread) => {
      const task = tasks.get(thread.threadId);
      return { ...thread, title: thread.threadId === 'general' ? 'General' : task ? task.summary : 'Deleted task', ref: task?.ref || null, status: task?.status || null };
    }),
  };
}
async function taskThreadContext(store, threadId) {
  if (threadId === 'general') return '';
  const task = await store.getTaskView(threadId).catch((error) => { throw error.status === 404 ? badRequest('threadId does not match a stored task') : error; });
  const lines = [
    `This conversation is about Waypoint task ${task.ref || task.id}: ${task.summary}`,
    task.description ? `Description: ${task.description}` : '',
    `Status: ${task.status}. Run state: ${task.state}. Assignee: ${task.podId ? `${task.podId}${task.seatId ? `/${task.seatId}` : ''}` : 'none'}.`,
    `Use taskId ${task.ref || task.id} with update_task, run_task, and task_status. Keep this conversation focused on this task.`,
  ];
  return lines.filter(Boolean).join('\n');
}
function actionSummary(tool, args = {}, result = {}) {
  const value = (v) => String(v ?? '').slice(0, 120);
  if (tool === 'create_task') return `${value(result.ref)} ${value(result.summary)}`;
  if (tool === 'update_task') return `${value(result.ref || args.taskId)} ${Object.keys(args).filter((key) => key !== 'taskId').join(', ')}`;
  if (tool === 'run_task' || tool === 'task_status') return `${value(args.taskId)} ${value(result.state)}`;
  if (tool === 'create_mission') return value(result.mission?.title || args.title);
  if (tool === 'create_template') return value(result.name || args.name);
  if (tool === 'clone_template') return value(result.podName || args.podName);
  if (tool === 'create_project') return value(result.name || args.name);
  if (['pod_status', 'pod_start', 'pod_stop'].includes(tool)) return `${value(args.podId)} ${value(result.status?.state)}`;
  if (tool === 'list_tasks') return `${result.tasks?.length ?? 0} tasks`;
  return '';
}
async function applyProjectMounts(before, after, { config, store, docker, taskRuns, logger }) {
  const podsOf = (project) => (project?.workspace === 'local' ? (project.githubSeats || []).map((address) => address.split('/')[0]) : []);
  const affected = [...new Set([...podsOf(before), ...podsOf(after)])];
  const result = { updated: [], pending: [] };
  if (!affected.length || config.dryRun) return result;
  const projects = await store.listProjects();
  for (const podId of affected) {
    try {
      const instance = await store.getInstance(podId);
      const status = await docker.lifecycle(instance, 'status');
      if (!status.status?.running) continue;
      const busy = [...(taskRuns?.executor?.activeSeats || [])].some((key) => key.startsWith(`${podId}/`));
      if (busy) { result.pending.push(podId); continue; }
      const started = await docker.lifecycle(instance, 'start', { projectMounts: podProjectMounts(projects, podId) });
      await store.recordLifecycle(instance.id, started, ({ podId: id, podName }) => docker.startPlan({ podId: id, podName }));
      if (started.recreated) result.updated.push(podId);
    } catch (error) {
      result.pending.push(podId);
      logger?.warn?.('project_mount_apply_failed', { podId, message: String(error.message || error).slice(0, 200) });
    }
  }
  return result;
}
async function installGithubTools(seats = [], previous = [], { config, store, podSeats, messaging, logger }) {
  const added = seats.filter((address) => !previous.includes(address));
  if (!added.length || config.dryRun || !messaging || !podSeats) return [];
  const installed = [];
  const byPod = new Map();
  for (const address of added) {
    const [podId, seatId] = address.split('/');
    byPod.set(podId, [...(byPod.get(podId) || []), seatId]);
  }
  for (const [podId, seatIds] of byPod) {
    try {
      const instance = await store.getInstance(podId);
      if (instance.state !== 'running') continue;
      await messaging.installSeatTools(instance, seatIds, podSeats);
      installed.push(...seatIds.map((seatId) => `${podId}/${seatId}`));
    } catch (error) {
      logger?.warn?.('github_tools_install_failed', { podId, message: String(error.message || error).slice(0, 200) });
    }
  }
  return installed;
}
async function withDetectedRepo(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.localPath || Object.hasOwn(body, 'repo')) return body;
  const found = await inspectLocalPath(body.localPath).catch(() => null);
  return found?.repo ? { ...body, repo: found.repo } : body;
}
async function seatGithubTool(request, tool, args, { store, messaging, github }) {
  if (!messaging || !github) throw forbidden('GitHub access is unavailable');
  const actor = await messaging.actorFromAuthorization(request.headers.authorization);
  if (actor === 'ceo') throw forbidden('GitHub access is for designated seats; ask a seat on the project to do it');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw badRequest('args must be an object');
  const allowed = await store.seatGithubRepos(actor);
  const repo = allowed.find((item) => item.toLowerCase() === String(args.repo || '').trim().replace(/\.git$/i, '').toLowerCase());
  if (!repo) throw forbidden('This seat is not designated for GitHub on that repository', { allowed });
  if (tool === 'github_token') {
    assertBridgeFields(args, ['repo']);
    const { token, expiresAt } = await github.repoToken(repo);
    return { repo, token, expiresAt };
  }
  assertBridgeFields(args, ['repo', 'method', 'path', 'body']);
  return github.api(repo, { method: args.method, path: args.path, body: args.body });
}
function assertBridgeFields(args, allowed) {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length) throw badRequest('unsupported message fields', { fields: extra.slice(0, 10).map((key) => key.slice(0, 64)) });
}
function bridgeTaskId(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw badRequest('args must be an object');
  const extra = Object.keys(args).filter((key) => key !== 'taskId');
  if (extra.length) throw badRequest('this bridge tool accepts only taskId', { fields: extra.slice(0, 10).map((key) => key.slice(0, 64)) });
  return String(args.taskId || '');
}
async function bridgePodLifecycle(config, store, docker, hermes, podSeats, messaging, podId, action) {
  let instance = await store.getInstance(podId, { dockerPlanFactory: ({ podId: id, podName }) => docker.startPlan({ podId: id, podName }) });
  if (action === 'start' && !config.dryRun) instance = await defaultPodModelFromCeo(store, hermes, instance);
  const result = await docker.lifecycle(instance, action, { projectMounts: podProjectMounts(await store.listProjects(), instance.id) });
  await store.recordLifecycle(instance.id, result, ({ podId: id, podName }) => docker.startPlan({ podId: id, podName }));
  if (action !== 'start' || result.dryRun || !result.status?.running) return result;
  const template = instance.templateId ? await store.getTemplate(instance.templateId) : undefined;
  const seats = publicSeatsResult(await podSeats.provision(await store.getInstance(instance.id), { template }));
  const readyProfiles = seats.seats.filter((seat) => seat.profile?.state === 'ready').map((seat) => seat.seatId);
  if (readyProfiles.length && messaging) await messaging.installSeatTools(instance, readyProfiles, podSeats);
  return { ...result, seats };
}

async function defaultPodModelFromCeo(store, hermes, instance) {
  if (instance.model) return instance;
  const template = instance.templateId ? await store.getTemplate(instance.templateId) : undefined;
  if (template?.config?.model) return instance;
  const ceo = await hermes.status();
  if (!ceo.model?.configured) throw conflict('CEO model is not configured; set it in Settings before starting a pod without a model');
  const { provider, default: model, api_mode, base_url } = ceo.model;
  return store.setPodDefaultModelIfMissing(instance.id, normalizeSeatModel({ provider, default: model, api_mode, base_url }, 'ceo'));
}

async function podSeatsAction(store, podSeats, podId, mode, options) {
  const instance = await store.getInstance(podId);
  let template;
  if (instance.templateId) {
    template = await store.getTemplate(instance.templateId).catch((error) => {
      throw error.status === 404 ? conflict('pod template not found; seat models cannot be resolved', { podId: instance.id }) : error;
    });
  }
  const result = mode === 'provision' ? await podSeats.provision(instance, { ...options, template }) : await podSeats.inspect(instance, { ...options, template });
  return publicSeatsResult(result);
}

async function podSeatAuthStart(store, podSeatAuth, podId, seatId, provider, body) {
  const instance = await store.getInstance(podId);
  return podSeatAuth.startLogin(instance, seatId, provider, body);
}

async function podSeatAuthSaveKey(store, podSeatAuth, podId, seatId, provider, body) {
  const instance = await store.getInstance(podId);
  return podSeatAuth.saveApiKey(instance, seatId, provider, body);
}

function bearerMatches(header, token) {
  const digest = (value) => createHash('sha256').update(String(value)).digest();
  return timingSafeEqual(digest(header || ''), digest(`Bearer ${token}`));
}

function assertMutationSafety(request) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
  const contentType = request.headers['content-type'] || '';
  if (!String(contentType).toLowerCase().startsWith('application/json')) {
    throw unsupportedMediaType('Mutation requests must use application/json');
  }
  const origin = request.headers.origin;
  if (!origin) return;
  let parsedOrigin;
  try { parsedOrigin = new URL(origin); }
  catch { throw forbidden('Foreign Origin is not allowed for local mutation requests'); }
  const host = String(request.headers.host || '');
  const devOrigins = new Set(['127.0.0.1:5173', 'localhost:5173']);
  if (parsedOrigin.host !== host && !devOrigins.has(parsedOrigin.host)) {
    throw forbidden('Foreign Origin is not allowed for local mutation requests');
  }
}

function decodeRouteParam(value) {
  try { return decodeURIComponent(value); }
  catch { throw badRequest('Route parameter is not valid percent-encoding'); }
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw badRequest('Request body must be valid JSON'); }
}
function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
