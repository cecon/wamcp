import { z } from 'zod';
export const jidSchema = z.string().regex(/^[0-9][0-9A-Za-z:._-]*@(s\.whatsapp\.net|g\.us|lid)$/);
