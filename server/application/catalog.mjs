import { HelpdeskError, requireAdmin, normalizeLabelTitle, validateCannedCode } from '../domain/helpdesk.mjs';

/** Labels (admin-managed) and canned responses (any agent), as in Chatwoot. */
export function catalogService({ helpdesk, bus }) {
  const findLabel = (id) => {
    const label = helpdesk.label(id);
    if (!label) throw new HelpdeskError('Etiqueta não encontrada', 404);
    return label;
  };
  const findCanned = (id) => {
    const canned = helpdesk.cannedResponse(id);
    if (!canned) throw new HelpdeskError('Resposta pronta não encontrada', 404);
    return canned;
  };
  return {
    labels: () => helpdesk.labels(),
    createLabel(actor, fields) {
      requireAdmin(actor);
      const title = normalizeLabelTitle(fields.title);
      if (helpdesk.labelByTitle(title)) throw new HelpdeskError('Etiqueta já existe', 409);
      const label = helpdesk.createLabel({ ...fields, title });
      bus.emit('label.created', label);
      return label;
    },
    updateLabel(actor, id, fields) {
      requireAdmin(actor);
      findLabel(id);
      const title = fields.title === undefined ? undefined : normalizeLabelTitle(fields.title);
      if (title && helpdesk.labelByTitle(title, id)) throw new HelpdeskError('Etiqueta já existe', 409);
      return helpdesk.updateLabel(id, { ...fields, title });
    },
    deleteLabel(actor, id) {
      requireAdmin(actor);
      findLabel(id);
      helpdesk.deleteLabel(id);
    },

    cannedResponses: (q) => helpdesk.cannedResponses(q),
    createCanned(_actor, { short_code, content }) {
      const code = validateCannedCode(short_code);
      if (helpdesk.cannedByCode(code)) throw new HelpdeskError('Atalho já existe', 409);
      return helpdesk.createCanned({ short_code: code, content });
    },
    updateCanned(_actor, id, { short_code, content }) {
      findCanned(id);
      const code = short_code === undefined ? undefined : validateCannedCode(short_code);
      if (code && helpdesk.cannedByCode(code, id)) throw new HelpdeskError('Atalho já existe', 409);
      return helpdesk.updateCanned(id, { short_code: code, content });
    },
    deleteCanned(actor, id) {
      requireAdmin(actor);
      findCanned(id);
      helpdesk.deleteCanned(id);
    },
  };
}
