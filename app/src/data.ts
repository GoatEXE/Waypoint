// Sample data for the "Launch v2 of the patient intake app" mission.
// Front-end only: everything here stands in for the host service's API.

export type ProjectId = 'web' | 'api' | 'cmp';
export type TaskStatus = 'running' | 'review' | 'done' | 'blocked' | 'queued' | 'decision';
export type RunStatus = 'passed' | 'failed' | 'superseded';
export type SeatStatus = TaskStatus | 'stopped';
export type Status = TaskStatus | RunStatus | 'stopped';

export interface Project { id: ProjectId; name: string; goal: string; repo: string; branch: string; env: string; pod: string; lastDone: string }
export interface TrailStep { from: string; verb: string; to: string; when: string; text: string; msg?: boolean; pending?: boolean }
export interface Message { from: string; to: string; text: string }
export interface Task {
  id: string; p: ProjectId; title: string; st: TaskStatus; owner: string; why: string; deps: string[];
  runs?: string[]; cost?: string; approval?: string; blockedBy?: string; trail?: TrailStep[]; msgs?: Message[];
}
export type DiffLine = [number, ' ' | '+' | '-', string];
export interface ChangedFile { path: string; add: number; del: number; lines: DiffLine[] }
export interface Run {
  task: string; st: RunStatus; when: string; dur: string; tokens: string; cost: string; seat: string; worktree: string;
  short: string; reason: string; summary: string; files: ChangedFile[]; tests: [string, string, string][]; testSum: string;
}
export interface Seat { name: string; role: string; pod: string | null; st: TaskStatus; task: string }
export interface Pod { name: string; template: string; p: ProjectId; uptime: string; learn: { memory: number; skills: number; instr: number } }
export interface InboxItem {
  id: string; kind: string; from: string; when: string; title: string; detail: string; task?: string;
  cta: string; declineLabel?: string; yes: string; no: string; review?: boolean;
}
export type LessonPick = 'seat' | 'project' | 'template' | 'discard';
export interface Lesson { id: string; seat: string; kind: string; ev: string; text: string; sug: LessonPick; flag?: string }
export type ChatEntry =
  | { who: 'you' | 'ceo'; time: string; text: string }
  | { tool: string }
  | { card: string };

export const projects: Project[] = [
  { id: 'web', name: 'intake-web', goal: 'Mobile-first intake flow', repo: '~/code/intake-web', branch: 'main', env: 'devcontainer · node 20', pod: 'web-squad-01', lastDone: 'WP-131 merged 2d ago' },
  { id: 'api', name: 'intake-api', goal: 'FHIR-backed intake API', repo: '~/code/intake-api', branch: 'main', env: 'compose · api, postgres, fhir', pod: 'api-pod-01', lastDone: 'WP-201 merged 3d ago' },
  { id: 'cmp', name: 'intake-compliance', goal: 'HIPAA review and e-consent', repo: '~/code/intake-compliance', branch: 'main', env: 'no containers', pod: 'compliance-01', lastDone: 'nothing merged yet' },
];

export const mission = {
  short: 'Patient intake v2',
  title: 'Launch v2 of the patient intake app',
  outcome: 'New patients finish intake on their phone in under 6 minutes, with insurance and consent captured before they arrive.',
  target: 'Nov 14',
  assignedTo: 'ceo',
  assignedOn: 'Oct 2',
};

export const tasks: Task[] = [
  { id: 'WP-142', p: 'web', title: 'Insurance card capture step', st: 'running', owner: 'frontend-2', why: 'The front desk re-keys about 40% of insurance details today. Capturing the card on the phone removes that step — and most of what blows the 6-minute budget.', deps: ['WP-131', 'WP-207'], runs: ['R-3', 'R-2', 'R-1'], cost: '$2.31 across 3 runs', approval: 'hire-ocr',
    trail: [
      { from: 'you', verb: 'assigned mission to', to: 'ceo', when: 'Oct 2', text: 'Launch v2 of the patient intake app.' },
      { from: 'ceo', verb: 'delegated to', to: 'lead-web', when: 'Oct 2', text: 'Break the intake flow into steps; insurance capture first.' },
      { from: 'lead-web', verb: 'handed off to', to: 'frontend-2', when: 'Oct 3', text: 'Own WP-142: camera capture, prefill fields, tests.' },
      { from: 'frontend-2', verb: 'asked', to: 'backend-1', when: 'Today 8:41', text: 'Quick question — does /drafts accept image refs yet?', msg: true },
      { from: 'ceo', verb: 'requested seat', to: 'ocr-specialist', when: 'Today 9:12', text: 'Low-light accuracy is weak. Awaiting your approval.', pending: true },
    ],
    msgs: [{ from: 'frontend-2', to: 'backend-1', text: 'Does /drafts accept image refs yet?' }, { from: 'backend-1', to: 'frontend-2', text: 'Yes, multipart. IDs come back in attachments[].' }] },
  { id: 'WP-138', p: 'web', title: 'Accessible form validation', st: 'review', owner: 'frontend-1', why: 'Errors must be announced and fixable without sight — required for the WCAG AA commitment in the launch plan.', deps: ['WP-131'], cost: '$1.12 across 2 runs', approval: 'merge-138' },
  { id: 'WP-131', p: 'web', title: 'Adopt v2 design tokens', st: 'done', owner: 'frontend-1', why: 'Every new step builds on the v2 tokens; doing this first avoids restyling later.', deps: [], cost: '$0.66 across 1 run' },
  { id: 'WP-145', p: 'web', title: 'Save draft when offline', st: 'blocked', owner: 'frontend-2', why: 'Patients often start intake on the bus. Losing progress is the top complaint about v1.', deps: ['WP-207'], blockedBy: 'Waiting on WP-207 · draft intake endpoint' },
  { id: 'WP-149', p: 'web', title: 'End-to-end tests for intake flow', st: 'queued', owner: 'qa-1', why: 'Proves the 6-minute path works on real devices before launch.', deps: ['WP-142', 'WP-145'] },
  { id: 'WP-201', p: 'api', title: 'Patient resource mapping', st: 'done', owner: 'backend-1', why: 'Intake data lands as standard FHIR Patient and Coverage resources the clinic EHR already reads.', deps: [] },
  { id: 'WP-207', p: 'api', title: 'Draft intake endpoint', st: 'running', owner: 'backend-1', why: 'Lets the app save partial intake. Unblocks offline drafts and card image uploads.', deps: ['WP-201'] },
  { id: 'WP-210', p: 'api', title: 'Insurance eligibility check', st: 'blocked', owner: 'backend-2', why: 'Tells patients before they arrive whether their coverage is active.', deps: ['WP-201'], blockedBy: 'Needs clearinghouse API key · approval in Inbox', approval: 'secret-ch' },
  { id: 'WP-214', p: 'api', title: 'Rate limiting on public endpoints', st: 'queued', owner: 'backend-2', why: 'Intake links are public; this protects the API on launch day.', deps: ['WP-207'] },
  { id: 'WP-301', p: 'cmp', title: 'Consent copy for minors', st: 'decision', owner: 'compliance-1', why: 'Consent has to be captured before arrival, and minors need guardian wording.', deps: [], blockedBy: 'Two drafts are waiting for your pick', approval: 'consent' },
  { id: 'WP-305', p: 'cmp', title: 'PHI logging audit', st: 'running', owner: 'compliance-1', why: 'No patient data may appear in agent or app logs.', deps: [] },
];

const diff1: DiffLine[] = [
  [41, ' ', 'export function InsuranceCard({ draft }: StepProps) {'],
  [42, '-', '  const [image, setImage] = useState<File | null>(null);'],
  [42, '+', '  const [sides, setSides] = useState<CardSides>({ front: null, back: null });'],
  [43, '+', '  const fields = useCardOcr(sides);'],
  [44, ' ', ''],
  [45, '+', '  useEffect(() => { if (fields) draft.prefill(fields); }, [fields]);'],
  [46, ' ', '  return ('],
  [47, '+', '    <CaptureFrame side={next(sides)} onCapture={capture} hint="Fill the frame" />'],
];
const diff2: DiffLine[] = [
  [12, '-', 'export async function readCard(img: Blob) {'],
  [12, '+', 'export async function readCard(img: Blob, opts = { deskew: true }) {'],
  [13, '+', '  const norm = opts.deskew ? await deskew(img) : img;'],
  [14, ' ', '  const text = await recognize(norm);'],
];

export const runs: Record<string, Run> = {
  'R-3': { task: 'WP-142', st: 'passed', when: '14 min ago', dur: '6m 12s', tokens: '41k', cost: '$0.84', seat: 'frontend-2', worktree: 'wt/WP-142-r3', short: 'Two-sided capture with prefill', reason: 'Card front and back captured, member ID and group number prefilled, all tests green. Handed to lead-web for review.',
    summary: 'Replaced the single photo upload with a guided two-sided capture. On-device OCR reads member ID, group and payer; results prefill the draft and stay editable. Images upload to /drafts as attachments (confirmed with backend-1). Low-light photos still misread about 1 in 6 — flagged to the CEO.',
    files: [{ path: 'src/steps/InsuranceCard.tsx', add: 148, del: 22, lines: diff1 }, { path: 'src/lib/ocr.ts', add: 41, del: 12, lines: diff2 }, { path: 'src/steps/index.ts', add: 3, del: 1, lines: [[8, '+', '  insurance: InsuranceCard,']] }, { path: 'tests/insurance-card.test.tsx', add: 20, del: 3, lines: [[30, '+', "it('prefills member id from back of card', async () => {"]] }],
    tests: [['✓', 'captures front then back', '212ms'], ['✓', 'prefills member id from back of card', '348ms'], ['✓', 'fields stay editable after prefill', '96ms'], ['✓', 'uploads both images to /drafts', '184ms'], ['✓', '14 more', '1.6s']], testSum: '18 passed · 0 failed' },
  'R-2': { task: 'WP-142', st: 'failed', when: '1 h ago', dur: '5m 40s', tokens: '38k', cost: '$0.79', seat: 'frontend-2', worktree: 'wt/WP-142-r2', short: 'Single-side capture with OCR', reason: '2 tests failing — rotated card photos are read upside down.',
    summary: 'Added OCR to the single photo upload. Rotated images break field extraction; next run will deskew before recognition and capture both sides.',
    files: [{ path: 'src/lib/ocr.ts', add: 29, del: 4, lines: diff2 }],
    tests: [['✓', 'captures front', '201ms'], ['✕', 'reads rotated card', '402ms'], ['✕', 'prefills member id', '377ms'], ['✓', '13 more', '1.4s']], testSum: '14 passed · 2 failed' },
  'R-1': { task: 'WP-142', st: 'superseded', when: 'Yesterday', dur: '4m 03s', tokens: '30k', cost: '$0.68', seat: 'frontend-2', worktree: 'wt/WP-142-r1', short: 'Server-side OCR prototype', reason: 'Approach replaced by on-device OCR so card images never leave the phone unprocessed.',
    summary: 'Sent card images to a server OCR endpoint. Dropped after compliance-1 noted PHI exposure risk.', files: [], tests: [], testSum: 'not run' },
};

export const seats: Seat[] = [
  { name: 'ceo', role: 'CEO', pod: null, st: 'running', task: 'Planning across 3 projects' },
  { name: 'lead-web', role: 'Lead', pod: 'web-squad-01', st: 'running', task: 'Reviewing WP-142 · R-3' },
  { name: 'frontend-1', role: 'Frontend', pod: 'web-squad-01', st: 'review', task: 'WP-138 awaiting merge' },
  { name: 'frontend-2', role: 'Frontend', pod: 'web-squad-01', st: 'running', task: 'WP-142 · starting R-4' },
  { name: 'qa-1', role: 'QA', pod: 'web-squad-01', st: 'queued', task: 'Idle · next WP-149' },
  { name: 'backend-1', role: 'Backend', pod: 'api-pod-01', st: 'running', task: 'WP-207 draft endpoint' },
  { name: 'backend-2', role: 'Backend', pod: 'api-pod-01', st: 'blocked', task: 'WP-210 waiting on secret' },
  { name: 'compliance-1', role: 'Compliance', pod: 'compliance-01', st: 'running', task: 'WP-305 PHI audit' },
];

export const pods: Pod[] = [
  { name: 'web-squad-01', template: 'web-squad v3', p: 'web', uptime: '2h 14m', learn: { memory: 9, skills: 2, instr: 1 } },
  { name: 'api-pod-01', template: 'api-pair v1', p: 'api', uptime: '5h 02m', learn: { memory: 4, skills: 0, instr: 0 } },
  { name: 'compliance-01', template: 'solo v1', p: 'cmp', uptime: '1d 3h', learn: { memory: 6, skills: 1, instr: 0 } },
];

export const inbox: InboxItem[] = [
  { id: 'hire-ocr', kind: 'Hire seat', from: 'ceo', when: '9:12', title: 'Add an ocr-specialist seat to web-squad-01 for two days', detail: 'Template ocr v1 · read-only on intake-web · no secrets', task: 'WP-142', cta: 'Approve', yes: 'Approved — seat starting in web-squad-01', no: 'Declined — CEO will keep frontend-2 on it' },
  { id: 'secret-ch', kind: 'Secret access', from: 'backend-2', when: '8:20', title: 'Give backend-2 the clearinghouse API key', detail: 'Bitwarden · machine account intake-api · read-only', task: 'WP-210', cta: 'Grant', yes: 'Granted — WP-210 unblocked', no: 'Denied' },
  { id: 'consent', kind: 'Decision', from: 'compliance-1', when: 'Yesterday', title: 'Pick consent wording for patients under 18', detail: 'Two drafts: guardian signs, or guardian + minor assent', task: 'WP-301', cta: 'Guardian + assent', declineLabel: 'Guardian only', yes: 'Picked guardian + minor assent', no: 'Picked guardian only' },
  { id: 'merge-138', kind: 'Merge', from: 'lead-web', when: 'Yesterday', title: 'Merge WP-138 · Accessible form validation', detail: 'Reviewed by lead-web · 31 tests passing · +204 −61', task: 'WP-138', cta: 'Merge', yes: 'Merged into main', no: 'Sent back to frontend-1' },
  { id: 'learn-web', kind: 'Learning review', from: 'web-squad-01', when: 'When stopped', title: 'Review what web-squad-01 learned before it stops', detail: '5 candidate lessons · 1 contains PHI', review: true, cta: 'Start review', declineLabel: 'Later', yes: 'Reviewed and applied', no: 'Postponed' },
];

export const lessons: Lesson[] = [
  { id: 'L1', seat: 'frontend-2', kind: 'memory', ev: 'R-3', text: 'Aetna and Cigna cards print the member ID on the back. Capture both sides by default.', sug: 'project' },
  { id: 'L2', seat: 'frontend-1', kind: 'skill', ev: 'WP-138', text: 'Run axe-core against every step before marking an accessibility task done.', sug: 'template' },
  { id: 'L3', seat: 'qa-1', kind: 'memory', ev: 'session', text: 'Playwright in the devcontainer needs the chromium-headless-shell build.', sug: 'project', flag: 'Possible duplicate of project note #12' },
  { id: 'L4', seat: 'lead-web', kind: 'instruction', ev: 'WP-142', text: 'Split any step over ~200 lines into subtasks before handing off.', sug: 'seat' },
  { id: 'L5', seat: 'frontend-2', kind: 'memory', ev: 'R-2', text: 'Test patient Jane R., DOB 04/11/1987, member ID W2841…', sug: 'discard', flag: 'Contains PHI' },
];

export const chat: ChatEntry[] = [
  { who: 'you', time: 'Oct 2', text: 'Launch v2 of the patient intake app. New patients should finish intake on their phone in under 6 minutes, with insurance and consent captured before arrival. Target Nov 14.' },
  { tool: 'missions.create · projects.link ×3 · pods.start web-squad v3, api-pair v1, solo v1' },
  { who: 'ceo', time: 'Oct 2', text: 'Set up three projects — intake-web, intake-api and intake-compliance — each with its own pod. Insurance capture and drafts go first; they carry most of the time savings.' },
  { who: 'you', time: '9:10', text: 'How is insurance capture going?' },
  { who: 'ceo', time: '9:12', text: "frontend-2 has a passing run on WP-142 (R-3): both sides captured, fields prefilled. Low-light photos still misread about 1 in 6. I'd rather bring in an OCR specialist for two days than stretch frontend-2." },
  { tool: 'seats.request role=ocr-specialist template=ocr v1 pod=web-squad-01' },
  { card: 'hire-ocr' },
];

export const seatTerminals: Record<string, [string, 'txt' | 'muted' | 'acc' | 'hi'][]> = {
  'frontend-2': [['$ hermes run --profile frontend-2 --task WP-142', 'txt'], ['› reading src/steps/InsuranceCard.tsx', 'muted'], ['› pnpm test insurance-card', 'muted'], ['  ✓ 18 passed (2.4s)', 'acc'], ['› ask backend-1 "Does /drafts accept image refs yet?"', 'muted'], ['  ← backend-1: Yes, multipart. IDs in attachments[].', 'txt'], ['› starting R-4: low-light preprocessing', 'txt']],
  'backend-2': [['$ hermes run --profile backend-2 --task WP-210', 'txt'], ['› secrets.get clearinghouse/api-key', 'muted'], ['  ✕ not authorized for machine account intake-api', 'hi'], ['› requested access · waiting on approval', 'muted']],
};

export interface Artifact { kind: string; name: string; p: ProjectId; src: string; to: string; img?: boolean }

// Shown in the side pane's Artifacts tab.
export const paneArtifacts: Artifact[] = [
  { kind: 'screenshot', name: 'insurance-step-mobile.png', src: 'R-3', p: 'web', img: true, to: '/runs/R-3' },
  { kind: 'diff', name: 'WP-142 · +212 −38', src: 'R-3', p: 'web', to: '/runs/R-3' },
  { kind: 'report', name: 'vitest-R-3.json', src: 'R-3', p: 'web', to: '/runs/R-3' },
  { kind: 'doc', name: 'consent-minors-drafts.md', src: 'compliance-1', p: 'cmp', to: '/tasks/WP-301' },
  { kind: 'report', name: 'vitest-R-2.json', src: 'R-2', p: 'web', to: '/runs/R-2' },
];

// Shown on the Workspace › Artifacts page.
export const allArtifacts: Artifact[] = [
  { kind: 'screenshot', name: 'insurance-step-mobile.png', p: 'web', src: 'R-3', to: '/runs/R-3' },
  { kind: 'diff', name: 'WP-142 · +212 −38', p: 'web', src: 'R-3', to: '/runs/R-3' },
  { kind: 'story', name: 'Steps/InsuranceCard', p: 'web', src: 'R-3', to: '/runs/R-3' },
  { kind: 'report', name: 'vitest-R-3.json', p: 'web', src: 'R-3', to: '/runs/R-3' },
  { kind: 'report', name: 'vitest-R-2.json', p: 'web', src: 'R-2', to: '/runs/R-2' },
  { kind: 'schema', name: 'draft-intake.openapi.yaml', p: 'api', src: 'WP-207', to: '/tasks/WP-207' },
  { kind: 'report', name: 'fhir-contract-tests.html', p: 'api', src: 'routine', to: '/routines' },
  { kind: 'doc', name: 'consent-minors-drafts.md', p: 'cmp', src: 'WP-301', to: '/tasks/WP-301' },
  { kind: 'report', name: 'phi-log-scan-0600.txt', p: 'cmp', src: 'routine', to: '/routines' },
];

export interface Routine { id: string; name: string; seat: string; scope: string; schedule: string; lastState: 'ok' | 'warn'; last: string; next: string }
export const routines: Routine[] = [
  { id: 'r1', name: 'Weekly mission digest', seat: 'ceo', scope: 'mission', schedule: 'Mondays 08:00', lastState: 'ok', last: 'Mon 08:00 · sent', next: 'Oct 12 08:00' },
  { id: 'r2', name: 'Dependency and CVE check', seat: 'qa-1', scope: 'intake-web', schedule: 'Daily 02:00', lastState: 'ok', last: 'Today 02:00 · no issues', next: 'Tomorrow 02:00' },
  { id: 'r3', name: 'PHI log scan', seat: 'compliance-1', scope: 'all projects', schedule: 'Every 6 h', lastState: 'warn', last: '06:00 · 1 finding → WP-305', next: '12:00' },
  { id: 'r4', name: 'Contract tests against FHIR sandbox', seat: 'backend-1', scope: 'intake-api', schedule: 'Daily 03:30', lastState: 'ok', last: 'Today 03:30 · 42 passed', next: 'Tomorrow 03:30' },
  { id: 'r5', name: 'Stale worktree cleanup', seat: 'lead-web', scope: 'intake-web', schedule: 'Fridays 18:00', lastState: 'ok', last: 'Fri 18:00 · 6 removed', next: 'Oct 9 18:00' },
];

export interface Skill { name: string; ver: string; desc: string; used: string; proposed?: boolean }
export const skillGroups: { label: string; sub: string; items: Skill[] }[] = [
  { label: 'Templates', sub: 'Shared by every seat started from a template', items: [
    { name: 'web-squad/component-tests', ver: 'v3', desc: 'Write a Vitest + Testing Library test for every new step component.', used: '4 seats · web-squad v3' },
    { name: 'web-squad/a11y-gate', ver: 'v4 draft', desc: 'Run axe-core against every step before marking an accessibility task done.', used: 'From review of web-squad-01', proposed: true },
    { name: 'api-pair/fhir-mapping', ver: 'v1', desc: 'Map intake fields to FHIR Patient and Coverage resources.', used: '2 seats · api-pair v1' } ] },
  { label: 'Project', sub: 'Knowledge tied to one repository', items: [
    { name: 'intake-web/devcontainer', ver: 'v2', desc: 'Start the devcontainer and Storybook; use chromium-headless-shell for Playwright.', used: 'intake-web' },
    { name: 'intake-web/insurance-cards', ver: 'v1 draft', desc: 'Capture both sides by default; several payers print member ID on the back.', used: 'From review of web-squad-01', proposed: true } ] },
  { label: 'Seat', sub: 'Lives in one Hermes profile', items: [
    { name: 'lead-web/split-large-steps', ver: 'v1', desc: 'Split any step over ~200 lines into subtasks before handing off.', used: 'lead-web' },
    { name: 'ceo/hiring-policy', ver: 'v2', desc: 'Request a specialist seat when a task needs more than two days outside a seat template.', used: 'ceo' } ] },
];

export interface Connector { id: string; name: string; kind: string; on: boolean; detail: string; scope: string }
export const connectors: Connector[] = [
  { id: 'bw', name: 'Bitwarden Secrets Manager', kind: 'Secrets', on: true, detail: '3 machine accounts. Secrets are fetched at seat start-up; project containers get their own scoped delivery.', scope: 'intake-web · intake-api · ceo' },
  { id: 'git', name: 'Local Git', kind: 'Repositories', on: true, detail: '3 repositories linked. Each concurrent task gets its own worktree.', scope: '~/code/intake-*' },
  { id: 'dk', name: 'Docker', kind: 'Containers', on: true, detail: 'Engine on this machine. Runs pods and project dev containers.', scope: 'pods · devcontainers' },
  { id: 'hm', name: 'Hermes', kind: 'Agent harness', on: true, detail: '9 profiles stored outside containers. One process per profile.', scope: '~/.waypoint/profiles' },
  { id: 'mcp', name: 'Waypoint tools', kind: 'MCP server', on: true, detail: 'The narrow tool API the CEO and seats call: tasks, seats, pods, approvals.', scope: 'ceo: full · seats: tasks, messages' },
  { id: 'gh', name: 'GitHub', kind: 'Code hosting', on: false, detail: 'Open pull requests from task worktrees and sync review comments.', scope: 'not connected' },
  { id: 'sl', name: 'Slack', kind: 'Notifications', on: false, detail: 'Send approvals and the weekly digest to a channel.', scope: 'not connected' },
];

export const podTemplates: { name: string; seats: string; limits: string }[] = [
  { name: 'web-squad v3', seats: 'lead · 2 frontend · qa', limits: '4 seats · 8 CPU · 16 GB' },
  { name: 'api-pair v1', seats: '2 backend', limits: '2 seats · 4 CPU · 8 GB' },
  { name: 'solo v1', seats: '1 seat, any role', limits: '1 seat · 2 CPU · 4 GB' },
  { name: 'ocr v1', seats: 'ocr-specialist', limits: '1 seat · 4 CPU · 8 GB' },
];
