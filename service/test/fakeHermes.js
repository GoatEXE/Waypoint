import { NativeHost } from '../src/hermesHost.js';

export function fakeHermes(mock) {
  const host = new NativeHost({ hermes: { home: mock.home || '/hermes-home', bin: 'hermes', python: 'python' } });
  return {
    host,
    runHermes(args, options = {}) {
      const command = host.hermes(args);
      return this.runner(command.command, command.args, { ...options, ...command.options });
    },
    spawnHermes(command, options = {}) {
      return this.spawner(command.command, command.args, { ...options, ...command.options });
    },
    async execPython(script, input, options = {}) {
      const command = host.python(script, options.args || []);
      return this.runner(command.command, command.args, { ...options, ...command.options, input });
    },
    ...mock,
  };
}
