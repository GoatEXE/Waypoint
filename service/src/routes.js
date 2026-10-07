import { createHash, timingSafeEqual } from 'node:crypto';
import { publicConfig } from './config.js';
import { badRequest, conflict, forbidden, toErrorResponse, unsupportedMediaType } from './errors.js';
import { normalizeSeatModel, publicSeatsResult } from './podSeats.js';

const NOT_FOUND = { status: 404, body: { error: { code: 'not_found', message: 'Route not found' } } };

// Control API: served only on the host-only named pipe / Unix socket.
export function createHandler({ config, store, docker, hermes, podSeats, podSeatAuth, taskRuns, messaging, logger }) {
  return createJsonHandler(logger, (request, url) => {
    assertMutationSafety(request);
    return route(request, url, { config, store, docker, hermes, podSeats, podSeatAuth, taskRuns, messaging });
  });
}

// Bridge API: the only thing served on the container-reachable TCP port.
export function createBridgeHandler({ config, store, docker, hermes, podSeats, taskRuns, messaging, logger }) {
  return createJsonHandler(logger, async (request, url) => {
    if (request.method !== 'POST' || url.pathname !== '/bridge/tools') return NOT_FOUND;
    assertMutationSafety(request);
    return { body: await bridgeTool(request, { config, store, docker, hermes, podSeats, taskRuns, messaging }) };
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
async function route(request, url, { config, store, docker, hermes, podSeats, podSeatAuth, taskRuns, messaging }) {
  if (request.method === 'GET' && url.pathname === '/healthz') return { body: { ok: true, service: config.serviceName, dryRun: config.dryRun, uptimeSeconds: Math.round(process.uptime()) } };
  if (request.method === 'GET' && url.pathname === '/config') return { body: publicConfig(config) };
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
  if (request.method === 'GET' && url.pathname === '/hermes/ceo/conversation') return { body: await hermes.ceoConversation() };
  if (request.method === 'POST' && url.pathname === '/hermes/ceo/messages') return { body: await hermes.sendCeoMessage(await readBody(request)) };
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
    const result = await docker.lifecycle(instance, body.action);
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
    // Record-only: persists the seat's non-secret model choice; no container exec or model call.
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
  match = url.pathname.match(/^\/tasks\/([^/]+)$/);
  if (request.method === 'GET' && match) return { body: await store.getTask(match[1]) };
  match = url.pathname.match(/^\/tasks\/([^/]+)\/run$/);
  if (request.method === 'POST' && match) {
    const result = await taskRuns.start(match[1], await readBody(request));
    return { status: result.dryRun ? 200 : 202, body: result };
  }
  match = url.pathname.match(/^\/tasks\/([^/]+)\/manual-retry$/);
  if (request.method === 'POST' && match) {
    const body = await readBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.reviewed !== true || Object.keys(body).some((key) => key !== 'reviewed')) throw badRequest('manual retry requires { reviewed: true }');
    const result = await taskRuns.start(match[1], {}, { manualRetry: true });
    return { status: result.dryRun ? 200 : 202, body: result };
  }
  return NOT_FOUND;
}
async function bridgeTool(request, { config, store, docker, hermes, podSeats, taskRuns, messaging }) {
  const body = await readBody(request);
  const tool = String(body.tool || '');
  const args = body.args || {};
  if (['org_chart', 'inbox', 'send_message', 'ack_message'].includes(tool)) {
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
    if (tool === 'ack_message') {
      assertBridgeFields(args, ['messageId']);
      return messaging.acknowledge(actor, args.messageId);
    }
    assertBridgeFields(args, ['to', 'text']);
    return messaging.send(actor, args, { bridge: true });
  }
  if (!bearerMatches(request.headers.authorization, config.bridge.token)) throw forbidden('Waypoint bridge token is required');
  // Peer mail can wake the CEO, but cannot authorize control-plane actions.
  // The CEO user conversation is excluded by the same Hermes turn lock.
  if (hermes.mailboxTurnInFlight) throw forbidden('CEO control tools are unavailable during a peer-message turn');
  if (tool === 'health') return { ok: true, service: config.serviceName };
  if (tool === 'create_template') return store.createTemplate(args);
  if (tool === 'clone_template') return store.cloneTemplate(String(args.templateId || ''), args, ({ podId, podName }) => docker.startPlan({ podId, podName }));
  if (tool === 'pod_status') return bridgePodLifecycle(config, store, docker, hermes, podSeats, messaging, String(args.podId || ''), 'status');
  if (tool === 'pod_start') return bridgePodLifecycle(config, store, docker, hermes, podSeats, messaging, String(args.podId || ''), 'start');
  if (tool === 'pod_stop') return bridgePodLifecycle(config, store, docker, hermes, podSeats, messaging, String(args.podId || ''), 'stop');
  if (tool === 'create_task') return store.createTask(args);
  if (tool === 'create_mission') return store.createMission(args, { source: 'ceo' });
  if (tool === 'link_mission') return store.linkMission(String(args.missionId || ''), args);
  if (tool === 'list_missions') return { missions: await store.listMissions() };
  if (tool === 'run_task') {
    // Same service path as POST /tasks/:id/run, but the CEO passes only the task id: no prompt, files, or retry flags.
    const { plan: _plan, ...summary } = await taskRuns.start(bridgeTaskId(args), {});
    return summary;
  }
  if (tool === 'task_status') return taskRuns.status(bridgeTaskId(args));
  throw badRequest('unsupported bridge tool', { tool });
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
  const result = await docker.lifecycle(instance, action);
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

// Seat models come from stored seat, pod, or template records; the request never supplies credentials.
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
