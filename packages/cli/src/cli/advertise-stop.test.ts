// bonjourAdvertiser's stop, against a stubbed bonjour-service: however the
// multicast socket behaves, stop settles within its wait, so a signal
// always reaches the rest of serve's shutdown.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vite-plus/test';
import { type AdvertisedService, bonjourAdvertiser } from './advertise.ts';

type Step = (done: () => void) => void;

const bonjour = vi.hoisted(() => ({
  unpublishAll: (() => {}) as Step,
  destroy: (() => {}) as Step,
}));

vi.mock('bonjour-service', () => ({
  Bonjour: class {
    publish() {}
    unpublishAll(done: () => void) {
      bonjour.unpublishAll(done);
    }
    destroy(done: () => void) {
      bonjour.destroy(done);
    }
  },
}));

const service: AdvertisedService = {
  name: 'test',
  type: 'configure-env',
  protocol: 'tcp',
  port: 4000,
  txt: { v: '0.0.0', name: 'test', tls: '0' },
};

async function settlesWithin(ms: number, promise: Promise<void>) {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

describe('bonjourAdvertiser stop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles once the goodbye is sent and the socket closes', async () => {
    bonjour.unpublishAll = (done) => done();
    bonjour.destroy = (done) => done();
    const advertisement = await bonjourAdvertiser()(service, () => {});
    expect(await settlesWithin(0, advertisement.stop())).toBe(true);
  });

  it('settles within its wait when the goodbye never completes', async () => {
    bonjour.unpublishAll = () => {};
    bonjour.destroy = (done) => done();
    const advertisement = await bonjourAdvertiser()(service, () => {});
    expect(await settlesWithin(1000, advertisement.stop())).toBe(true);
  });

  it('settles within its wait when the socket never reports closing', async () => {
    bonjour.unpublishAll = (done) => done();
    bonjour.destroy = () => {};
    const advertisement = await bonjourAdvertiser()(service, () => {});
    expect(await settlesWithin(1000, advertisement.stop())).toBe(true);
  });
});
