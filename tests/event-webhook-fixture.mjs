import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { eventWebhook } from '../server/adapters/outbound/event-webhook.mjs';

export const subscription = {
  id: 'sub_test',
  url: 'https://receiver.example.com:8443/callback?key=opaque',
  secret: `whsec_${Buffer.alloc(32, 7).toString('base64')}`,
};
export const event = { eventId: 'evt_test', name: 'message.created', data: { text: 'Olá 👋' } };
export const publicRecords = [{ address: '93.184.216.34', family: 4 }];

export function fixture({ respond, resolve, ...options } = {}) {
  const calls = [];
  const resolutions = [];
  const request = (settings, callback) => {
    const req = new EventEmitter();
    req.destroy = () => {
      req.destroyed = true;
    };
    req.end = (body) => {
      const call = { settings, body, req };
      calls.push(call);
      queueMicrotask(() => {
        if (respond) return respond(call, callback);
        reply(callback, 200, JSON.stringify({ challenge: JSON.parse(body).challenge }));
      });
    };
    return req;
  };
  const webhook = eventWebhook({
    request,
    resolve: async (...args) => {
      resolutions.push(args);
      return resolve ? resolve(...args) : publicRecords;
    },
    now: () => 1700000000000,
    ...options,
  });
  return { webhook, calls, resolutions };
}

export function reply(callback, status, body = '', headers = {}) {
  const response = Readable.from([Buffer.from(body)]);
  response.statusCode = status;
  response.headers = headers;
  callback(response);
  return response;
}
