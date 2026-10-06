import { HelpdeskError, requireAdmin, validatePassword, isAdmin } from '../domain/helpdesk.mjs';
import { validateSchedule, validateTimezone } from '../domain/schedule.mjs';

const SESSION_TTL = 7 * 86400000;
const normalizeEmail = (email) => String(email).trim().toLowerCase();

/** Agents, authentication, teams and inbox administration. */
export function accountService({ users, helpdesk, hasher, bus }) {
  const findUser = (id) => {
    const user = users.user(id);
    if (!user) throw new HelpdeskError('Agente não encontrado', 404);
    return user;
  };
  const findTeam = (id) => {
    const team = users.team(id);
    if (!team) throw new HelpdeskError('Time não encontrado', 404);
    return team;
  };
  const findInbox = (id) => {
    const inbox = helpdesk.inbox(id);
    if (!inbox) throw new HelpdeskError('Caixa de entrada não encontrada', 404);
    return inbox;
  };
  const requireUsers = (ids) => ids.forEach(findUser);
  return {
    needsBootstrap: () => users.countUsers() === 0,
    /** The desktop owner creates the first administrator; afterwards the endpoint is closed. */
    async bootstrap({ name, email, password }) {
      if (users.countUsers() > 0) throw new HelpdeskError('O administrador já foi criado', 409);
      validatePassword(password);
      const admin = users.createUser({
        name,
        email: normalizeEmail(email),
        role: 'administrator',
        passwordHash: await hasher.hash(password),
      });
      helpdesk.syncInboxes();
      for (const inbox of helpdesk.inboxes()) users.addInboxMembers(inbox.id, [admin.id]);
      return admin;
    },
    async login(email, password, userAgent) {
      const credentials = users.credentials(normalizeEmail(email));
      // Always run scrypt so response time does not reveal which emails exist.
      const valid = await hasher.verify(password, credentials?.password_hash || 'scrypt$AAAA$AAAA');
      if (!credentials || !valid || !credentials.active)
        throw new HelpdeskError('E-mail ou senha inválidos', 401);
      const session = users.createWebSession(credentials.id, SESSION_TTL, userAgent);
      return { ...session, user: users.user(credentials.id), maxAge: SESSION_TTL };
    },
    logout: (cookie) => users.deleteWebSession(cookie),
    /** Resolves a browser session cookie into the active user plus its CSRF token. */
    authenticateCookie(cookie) {
      const session = users.webSession(cookie);
      const user = session && users.user(session.user_id);
      return user?.active ? { user, csrf: session.csrf } : null;
    },
    authenticateApiToken(token) {
      const owner = users.apiTokenOwner(token);
      const user = owner?.owner_type === 'user' ? users.user(owner.owner_id) : null;
      return user?.active ? { user } : null;
    },
    isActive: (userId) => Boolean(users.user(userId)?.active),
    me: (user) => ({ ...user, inbox_ids: users.memberInboxIds(user.id) }),
    issueApiToken: (user) => ({ token: users.issueApiToken('user', user.id) }),
    async updateProfile(user, { name, display_name, availability, current_password, password }) {
      const fields = { name, display_name, availability };
      if (password !== undefined) {
        validatePassword(password);
        if (!(await hasher.verify(current_password || '', users.passwordHash(user.id))))
          throw new HelpdeskError('Senha atual incorreta', 403);
        fields.password_hash = await hasher.hash(password);
      }
      const updated = users.updateUser(user.id, fields);
      if (availability && availability !== user.availability)
        bus.emit('presence.update', { user_id: user.id, availability });
      return updated;
    },

    agents: () => users.users().map((u) => ({ ...u, inbox_ids: users.memberInboxIds(u.id) })),
    async createAgent(actor, { name, email, role, password, inbox_ids = [] }) {
      requireAdmin(actor);
      validatePassword(password);
      if (users.emailTaken(normalizeEmail(email))) throw new HelpdeskError('E-mail já cadastrado', 409);
      inbox_ids.forEach(findInbox);
      const agent = users.createUser({
        name,
        email: normalizeEmail(email),
        role,
        passwordHash: await hasher.hash(password),
      });
      for (const inboxId of inbox_ids) users.addInboxMembers(inboxId, [agent.id]);
      return agent;
    },
    async updateAgent(actor, id, { name, display_name, role, active, password }) {
      requireAdmin(actor);
      const agent = findUser(id);
      const demoting = (role && role !== 'administrator') || active === false;
      if (isAdmin(agent) && demoting && users.countAdmins() <= 1)
        throw new HelpdeskError('É preciso manter ao menos um administrador ativo', 409);
      const fields = { name, display_name, role, active };
      if (password !== undefined) {
        validatePassword(password);
        fields.password_hash = await hasher.hash(password);
      }
      const updated = users.updateUser(id, fields);
      if (active === false || password !== undefined) users.deleteUserSessions(id);
      return updated;
    },
    deleteAgent(actor, id) {
      requireAdmin(actor);
      const agent = findUser(id);
      if (agent.id === actor.id) throw new HelpdeskError('Você não pode excluir a própria conta', 409);
      if (isAdmin(agent) && users.countAdmins() <= 1)
        throw new HelpdeskError('É preciso manter ao menos um administrador ativo', 409);
      users.deleteUser(id);
    },

    teams: () => users.teams(),
    createTeam(actor, team) {
      requireAdmin(actor);
      if (users.teamByName(team.name)) throw new HelpdeskError('Já existe um time com esse nome', 409);
      return users.createTeam(team);
    },
    updateTeam(actor, id, fields) {
      requireAdmin(actor);
      findTeam(id);
      if (fields.name && users.teamByName(fields.name, id))
        throw new HelpdeskError('Já existe um time com esse nome', 409);
      return users.updateTeam(id, fields);
    },
    deleteTeam(actor, id) {
      requireAdmin(actor);
      findTeam(id);
      users.deleteTeam(id);
    },
    teamMembers: (id) => {
      findTeam(id);
      return users.teamMembers(id);
    },
    changeTeamMembers(actor, id, userIds, add) {
      requireAdmin(actor);
      findTeam(id);
      requireUsers(userIds);
      if (add) users.addTeamMembers(id, userIds);
      else users.removeTeamMembers(id, userIds);
      return users.teamMembers(id);
    },

    inboxes(user) {
      helpdesk.syncInboxes();
      return helpdesk.inboxes(isAdmin(user) ? null : users.memberInboxIds(user.id));
    },
    inbox(user, id) {
      const inbox = findInbox(id);
      if (!isAdmin(user) && !users.memberInboxIds(user.id).includes(id))
        throw new HelpdeskError('Caixa de entrada não encontrada', 404);
      return inbox;
    },
    updateInbox(actor, id, fields) {
      requireAdmin(actor);
      findInbox(id);
      if (fields.timezone) validateTimezone(fields.timezone);
      return helpdesk.updateInbox(id, fields);
    },
    workingHours(actor, id) {
      requireAdmin(actor);
      findInbox(id);
      return helpdesk.workingHours(id);
    },
    setWorkingHours(actor, id, days) {
      requireAdmin(actor);
      findInbox(id);
      validateSchedule(days);
      helpdesk.setWorkingHours(id, days);
      return helpdesk.workingHours(id);
    },
    inboxMembers: (actor, id) => {
      requireAdmin(actor);
      findInbox(id);
      return users.inboxMembers(id);
    },
    changeInboxMembers(actor, id, userIds, add) {
      requireAdmin(actor);
      findInbox(id);
      requireUsers(userIds);
      if (add) users.addInboxMembers(id, userIds);
      else users.removeInboxMembers(id, userIds);
      return users.inboxMembers(id);
    },
  };
}
