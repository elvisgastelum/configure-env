// `serve --advertise` over real multicast: a browser on the same host
// finds the service serve publishes, and loses it when serve stops.
// Opt-in, since multicast depends on the machine's network: set
// CONFIGURE_ENV_MDNS_IT=1 to run it. The packets loop back to this host;
// to keep them on the loopback interface, run it where lo is the only
// interface, with multicast on (`ip link set lo multicast on` and
// `ip route add 224.0.0.0/4 dev lo`), such as a container started with
// `--network none --cap-add NET_ADMIN`. CONFIGURE_ENV_MDNS_IT_INTERFACE
// names the interface address to use instead of the default route's. On
// macOS the terminal needs the Local Network permission.

import { Bonjour, type Service } from 'bonjour-service';
import { describe, expect, it } from 'vite-plus/test';
import { bonjourAdvertiser } from './advertise.ts';
import { VERSION } from './help.ts';
import { main } from './main.ts';
import type { ServeRuntime } from './serve.ts';
import { useProject } from './test-helpers.ts';

const project = useProject({
  version: 1,
  variables: { PORT: { type: 'port', default: 3000 } },
  files: [{ path: '.env', policy: 'merge', variables: '*' }],
});

const MDNS = process.env.CONFIGURE_ENV_MDNS_IT_INTERFACE
  ? { interface: process.env.CONFIGURE_ENV_MDNS_IT_INTERFACE }
  : {};

describe.skipIf(process.env.CONFIGURE_ENV_MDNS_IT !== '1')(
  'serve --advertise over mDNS',
  () => {
    it('is found by a browser on the loopback interface, and gone once serve stops', async () => {
      const name = `configure-env-it-${process.pid}`;
      let stop: (signal: NodeJS.Signals) => void = () => {};
      const signal = new Promise<NodeJS.Signals>((resolve) => {
        stop = resolve;
      });
      const runtime: ServeRuntime = {
        // The server itself is stubbed: this test is about the network.
        start: async (options) => ({
          host: options.host ?? '0.0.0.0',
          port: 47_470,
          url: 'http://0.0.0.0:47470',
          launchUrl: `http://0.0.0.0:47470/launch?token=${options.token}`,
          close: async () => {},
        }),
        advertise: bonjourAdvertiser(MDNS),
        waitForSignal: () => signal,
        openBrowser: () => {},
      };
      const err: string[] = [];
      const bonjour = new Bonjour(
        MDNS as Record<string, unknown> as ConstructorParameters<
          typeof Bonjour
        >[0],
      );
      try {
        const browser = bonjour.find({ type: 'configure-env' });
        const seen = (event: 'up' | 'down') =>
          new Promise<Service>((resolve) => {
            browser.on(event, (service: Service) => {
              if (service.name === name) resolve(service);
            });
          });
        const up = seen('up');
        const down = seen('down');
        const running = main(
          [
            'serve',
            '--host',
            '0.0.0.0',
            '--unsafe-expose',
            '--advertise',
            '--name',
            name,
          ],
          {
            stdout: () => {},
            stderr: (line) => err.push(line),
            env: {},
            isTTY: false,
            cwd: project.root,
            serve: runtime,
          },
        );
        const found = await up;
        expect(found.type).toBe('configure-env');
        expect(found.protocol).toBe('tcp');
        expect(found.port).toBe(47_470);
        expect(found.txt).toEqual({ v: VERSION, name, tls: '0' });
        stop('SIGINT');
        expect(await running).toBe(0);
        expect((await down).name).toBe(name);
        expect(err.join('\n')).toContain(
          `advertised on the local network as "${name}"`,
        );
      } finally {
        await new Promise<void>((resolve) => bonjour.destroy(() => resolve()));
      }
    }, 20_000);
  },
);
