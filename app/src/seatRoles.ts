export type SeatRole = 'engineer' | 'designer' | 'reviewer' | 'researcher' | 'writer' | 'ops' | 'data' | 'manager' | 'generalist';

const RULES: [SeatRole, RegExp][] = [
  ['reviewer', /\b(review|reviewer|qa|test|tester|quality|audit|verif)/],
  ['designer', /\b(design|designer|ux|ui|visual|brand)/],
  ['researcher', /\b(research|researcher|explore|explorer|analyst|investigat|discover)/],
  ['writer', /\b(writ|writer|docs?|documentation|content|copy|editor)/],
  ['ops', /\b(ops|devops|infra|deploy|sre|platform|release|security)/],
  ['data', /\b(data|analytics|ml|model|sql)/],
  ['manager', /\b(manag|lead|pm|product|planner|coordinat)/],
  ['engineer', /\b(engineer|dev|developer|code|coder|backend|frontend|build|implement|program)/],
];

export function seatRole(id: string, description = ''): SeatRole {
  const idText = id.toLowerCase().replace(/[-_]/g, ' ');
  for (const [role, re] of RULES) if (re.test(idText)) return role;
  const text = description.toLowerCase();
  for (const [role, re] of RULES) if (re.test(text)) return role;
  return 'generalist';
}
