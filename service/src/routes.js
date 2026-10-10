import { createHash, timingSafeEqual } from 'node:crypto';
import { publicConfig } from './config.js';
import { badRequest, forbidden, toErrorResponse, unsupportedMediaType } from './errors.js';


const NOT_FOUND = { status: 404, body: { error: { code: 'not_found', message: 'Route not found' } } };

export function createHandler(ctx) {
  return createJsonHandler(ctx.logger, (request, url) => {
    assertMutationSafety(request);
    return route(request, url, ctx);
  });
}

export function createBridgeHandler(ctx) {
  return createJsonHandler(ctx.logger, async (request, url) => {
    if (request.method !== 'POST' || url.pathname !== '/bridge/tools') return NOT_FOUND;
    assertMutationSafety(request);
    return { body: await bridgeTool(request, ctx) };
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

async function route(request, url, { config, store, organization, hermes, board, pods, github, portal, orgSeats, seatFeedback, projectSync, logger }) {
  const { pathname } = url;
  const method = request.method;
  const feedbackMatch = pathname.match(/^\/seats\/([^/]+)\/feedback$/);
  if (feedbackMatch && seatFeedback) {
    const seat = decodeRouteParam(feedbackMatch[1]);
    if (method === 'GET') return { body: await seatFeedback.conversation(seat, url.searchParams.get('task') || '') };
    if (method === 'POST') {
      const body = await readBody(request);
      return { body: await seatFeedback.send(seat, body?.task || '', { message: body?.message }) };
    }
  }
  if (pathname === '/org/seats' && orgSeats) {
    if (method === 'GET') return { body: await orgSeats.list() };
    if (method === 'POST') return { status: 201, body: await orgSeats.hire(await readBody(request)) };
  }
  if (pathname === '/hermes-portal' && portal) {
    if (method === 'GET') return { body: portal.status() };
    if (method === 'DELETE') return { body: await portal.close() };
    if (method === 'POST') {
      const body = await readBody(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'target')) throw badRequest('body must be { target }');
      return { body: await portal.open(body.target) };
    }
  }
  if (pathname.startsWith('/github') && github) {
    if (method === 'GET' && pathname === '/github') return { body: await github.status({ fresh: url.searchParams.get('fresh') === '1' }) };
    if (method === 'POST' && pathname === '/github/manifest') {
      const body = await readBody(request);
      return { body: github.manifest({ origin: body.origin, owner: body.owner, orgName: (await organization.get())?.name }) };
    }
    if (method === 'POST' && pathname === '/github/complete') return { body: await github.completeManifest(await readBody(request)) };
    if (method === 'DELETE' && pathname === '/github') return { body: await github.disconnect() };
  }
  if (method === 'GET' && pathname === '/healthz') return { body: { ok: true, service: config.serviceName, dryRun: config.dryRun, uptimeSeconds: Math.round(process.uptime()) } };
  if (method === 'GET' && pathname === '/config') return { body: publicConfig(config) };
  if (method === 'GET' && pathname === '/organization') return { body: await organization.describe() };
  if (method === 'PUT' && pathname === '/organization') {
    const { organization: saved, identityChanged } = await organization.update(await readBody(request));
    if (identityChanged) void hermes.refreshCeoIdentity().catch((error) => logger.warn('ceo_identity_refresh_failed', { message: error.message }));
    return { body: { configured: true, organization: saved } };
  }

  if (method === 'GET' && pathname === '/hermes/status') return { body: await hermes.status({ nativeAuth: url.searchParams.get('nativeAuth') === 'fresh' ? 'fresh' : 'cached' }) };
  if (method === 'GET' && pathname === '/hermes/skills') return { body: await hermes.skills() };
  let match = pathname.match(/^\/hermes\/skills\/(.+)$/);
  if (method === 'GET' && match) return { body: await hermes.skill(decodeRouteParam(match[1])) };
  if (method === 'PUT' && match) return { body: await hermes.setSkillEnabled(decodeRouteParam(match[1]), await readBody(request)) };
  if (method === 'GET' && pathname === '/hermes/ceo/conversation') return { body: await hermes.ceoConversation(url.searchParams.get('threadId') || undefined) };
  if (method === 'GET' && pathname === '/hermes/ceo/threads') return { body: await ceoThreads(board, hermes) };
  if (method === 'POST' && pathname === '/hermes/ceo/messages') {
    const body = await readBody(request);
    const threadId = body?.threadId || undefined;
    const context = threadId ? await taskThreadContext(board, threadId) : '';
    return { body: await hermes.sendCeoMessage({ message: body?.message, threadId, context }) };
  }
  if (method === 'GET' && pathname === '/hermes/model-catalog') return { body: await hermes.modelCatalog(url.searchParams.get('provider') || '', { refresh: ['1', 'true'].includes(url.searchParams.get('refresh')) }) };
  if (method === 'POST' && pathname === '/hermes/lifecycle') return { body: await hermes.lifecycle((await readBody(request)).action) };
  if (method === 'PUT' && pathname === '/hermes/model') return { body: await hermes.saveModel(await readBody(request)) };
  match = pathname.match(/^\/hermes\/providers\/([^/]+)\/api-key$/);
  if (method === 'PUT' && match) return { body: await hermes.saveApiKey(match[1], await readBody(request)) };
  match = pathname.match(/^\/hermes\/providers\/([^/]+)\/login$/);
  if (method === 'POST' && match) return { status: 202, body: await hermes.startLogin(match[1], await readBody(request)) };
  match = pathname.match(/^\/hermes\/providers\/([^/]+)\/login\/([^/]+)$/);
  if (method === 'GET' && match) return { body: hermes.getLogin(match[1], match[2]) };
  if (method === 'DELETE' && match) return { body: hermes.cancelLogin(match[1], match[2]) };
  match = pathname.match(/^\/hermes\/providers\/([^/]+)\/login\/([^/]+)\/code$/);
  if (method === 'POST' && match) return { body: hermes.submitLoginCode(match[1], match[2], await readBody(request)) };

  if (method === 'GET' && pathname === '/tasks') return { body: await board.list() };
  if (method === 'POST' && pathname === '/tasks') return { status: 201, body: await board.create({ ...await readBody(request), createdBy: 'user' }) };
  match = pathname.match(/^\/tasks\/([^/]+)$/);
  if (method === 'GET' && match) return { body: await board.show(decodeRouteParam(match[1])) };
  match = pathname.match(/^\/tasks\/([^/]+)\/activity$/);
  if (method === 'GET' && match) return { body: await board.activity(decodeRouteParam(match[1])) };
  match = pathname.match(/^\/tasks\/([^/]+)\/comments$/);
  if (method === 'POST' && match) return { body: await board.comment(decodeRouteParam(match[1]), await readBody(request)) };
  match = pathname.match(/^\/tasks\/([^/]+)\/actions$/);
  if (method === 'POST' && match) return { body: await board.act(decodeRouteParam(match[1]), await readBody(request)) };

  if (method === 'GET' && pathname === '/pods') return { body: await pods.list() };
  if (method === 'POST' && pathname === '/pods') return { status: 201, body: await pods.create(await readBody(request)) };
  match = pathname.match(/^\/pods\/([^/]+)$/);
  if (method === 'GET' && match) return { body: await pods.show(decodeRouteParam(match[1])) };
  match = pathname.match(/^\/pods\/([^/]+)\/conversation$/);
  if (method === 'GET' && match) return { body: await pods.conversation(decodeRouteParam(match[1])) };
  match = pathname.match(/^\/pods\/([^/]+)\/close$/);
  if (method === 'POST' && match) return { body: await pods.close(decodeRouteParam(match[1])) };

  if (method === 'GET' && pathname === '/missions') return { body: { missions: await store.listMissions() } };
  if (method === 'POST' && pathname === '/missions') {
    const { created, mission } = await store.createMission(await readBody(request), { source: 'app' });
    return { status: created ? 201 : 200, body: mission };
  }
  match = pathname.match(/^\/missions\/([^/]+)$/);
  if (method === 'GET' && match) return { body: await store.getMission(match[1]) };
  if (method === 'DELETE' && match) return { body: await store.deleteMission(match[1]) };
  if (method === 'PATCH' && match) return { body: await store.updateMission(match[1], await readBody(request)) };
  match = pathname.match(/^\/missions\/([^/]+)\/links$/);
  if (method === 'POST' && match) return { body: await store.linkMission(match[1], await readBody(request)) };

  if (method === 'GET' && pathname === '/projects') return { body: { projects: await store.listProjects() } };
  if (method === 'POST' && pathname === '/projects') {
    const project = await store.createProject(await readBody(request));
    projectSync?.sync(project);
    return { status: 201, body: project };
  }
  match = pathname.match(/^\/projects\/([^/]+)$/);
  if (method === 'GET' && match) return { body: await store.getProject(decodeRouteParam(match[1])) };
  if (method === 'DELETE' && match) return { body: await store.deleteProject(decodeRouteParam(match[1])) };
  if (method === 'PATCH' && match) {
    const project = await store.updateProject(decodeRouteParam(match[1]), await readBody(request));
    projectSync?.sync(project);
    return { body: project };
  }
  return NOT_FOUND;
}

async function bridgeTool(request, { config, store, hermes, github, board, pods, projectSync }) {
  const body = await readBody(request);
  const tool = String(body.tool || '');
  const args = body.args || {};
  if (!bearerMatches(request.headers.authorization, config.bridge.token)) throw forbidden('Waypoint bridge token is required');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw badRequest('args must be an object');
  let result;
  try { result = await ceoControlTool(tool, args, { config, store, github, board, pods, projectSync }); }
  catch (error) {
    if (tool !== 'health') hermes.recordCeoAction?.(tool, String(error.message || 'failed'), 'error');
    throw error;
  }
  if (!['health', 'github_token'].includes(tool)) hermes.recordCeoAction?.(tool, actionSummary(tool, args, result));
  return result;
}

async function ceoControlTool(tool, args, { config, store, github, board, pods, projectSync }) {
  if (tool === 'health') return { ok: true, service: config.serviceName };
  if (tool === 'list_pods') { assertFields(args, []); return pods.list(); }
  if (tool === 'create_pod') return pods.create(args);
  if (tool === 'close_pod') { assertFields(args, ['pod']); return pods.close(String(args.pod || '')); }
  if (tool === 'list_tasks') {
    assertFields(args, []);
    const { tasks } = await board.list();
    return { tasks: tasks.map(({ id, ref, board: slug, title, status, assignee }) => ({ id, ref, board: slug, title, status, assignee })) };
  }
  if (tool === 'github_token') return githubToken(args, { store, github });
  if (tool === 'list_projects') {
    const projects = await store.listProjects();
    const slugs = projectSync ? await projectSync.slugs() : {};
    for (const project of projects) if (project.repo && !slugs[project.id]) projectSync?.sync(project);
    return { projects: projects.map((project) => ({ ...project, hermesProject: slugs[project.id] || null })) };
  }
  if (tool === 'create_project') {
    const project = await store.createProject(args);
    projectSync?.sync(project);
    return project;
  }
  if (tool === 'list_missions') return { missions: await store.listMissions() };
  if (tool === 'create_mission') return (await store.createMission(args, { source: 'ceo' }));
  if (tool === 'link_mission') {
    assertFields(args, ['missionId', 'taskId']);
    return store.linkMission(String(args.missionId || ''), { taskId: args.taskId });
  }
  if (tool === 'update_mission') {
    assertFields(args, ['missionId', 'status']);
    return store.updateMissionStatus(String(args.missionId || ''), args.status);
  }
  throw badRequest('unsupported bridge tool', { tool });
}

async function githubToken(args, { store, github }) {
  if (!github) throw forbidden('GitHub access is unavailable');
  assertFields(args, ['repo']);
  const allowed = await store.projectGithubRepos();
  if (!allowed.length) throw forbidden('No Waypoint project has a GitHub repository yet.');
  const wanted = String(args.repo || '').trim().replace(/\.git$/i, '').toLowerCase();
  if (!wanted && allowed.length > 1) throw badRequest(`Name the repository (for example gh -R ${allowed[0]} ...). Available: ${allowed.join(', ')}`, { allowed });
  const repo = wanted ? allowed.find((item) => item.toLowerCase() === wanted) : allowed[0];
  if (!repo) throw forbidden(`No GitHub access to ${wanted.slice(0, 100)}. Available: ${allowed.join(', ')}`, { allowed });
  const { token, expiresAt } = await github.repoToken(repo);
  return { repo, token, expiresAt };
}

async function ceoThreads(board, hermes) {
  const { threads, busyThreadId } = await hermes.listCeoThreads();
  const byId = new Map(threads.map((thread) => [thread.threadId, thread]));
  const general = byId.get('general');
  const tasks = (await board.list().catch(() => ({ tasks: [] }))).tasks.filter((task) => task.status !== 'archived');
  const taskThreads = tasks.map((task) => {
    const thread = byId.get(task.id);
    return { threadId: task.id, title: task.title, ref: task.ref, status: task.status, messageCount: thread?.messageCount || 0, updatedAt: thread?.updatedAt || task.createdAt, lastText: thread?.lastText || '' };
  }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { busyThreadId, threads: [{ ...general, title: 'General', ref: null, status: null }, ...taskThreads] };
}

async function taskThreadContext(board, threadId) {
  if (threadId === 'general') return '';
  const task = await board.show(threadId).catch((error) => { throw error.status === 404 ? badRequest('threadId does not match a board task') : error; });
  return [
    `This conversation is about board task ${task.ref || task.id} (${task.id}): ${task.title}`,
    task.body ? `Description: ${task.body.slice(0, 2000)}` : '',
    `Status: ${task.status}. Assignee: ${task.assignee || 'none'}.`,
    'Use "hermes kanban show" and the other kanban commands with this task id. Keep this conversation focused on this task.',
  ].filter(Boolean).join('\n');
}

function actionSummary(tool, args = {}, result = {}) {
  const value = (v) => String(v ?? '').slice(0, 120);
  if (tool === 'create_mission') return value(result.mission?.title || args.title);
  if (tool === 'create_project') return value(result.name || args.name);
  if (tool === 'update_mission') return `${value(args.missionId)} ${value(args.status)}`;
  if (tool === 'list_projects') return `${result.projects?.length ?? 0} projects`;
  if (tool === 'list_missions') return `${result.missions?.length ?? 0} missions`;
  if (tool === 'list_tasks') return `${result.tasks?.length ?? 0} tasks`;
  if (tool === 'create_pod' || tool === 'close_pod') return value(result.name);
  return '';
}

function assertFields(args, allowed) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw badRequest('body must be an object');
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length) throw badRequest('unsupported fields', { fields: extra.slice(0, 10).map((key) => key.slice(0, 64)) });
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
