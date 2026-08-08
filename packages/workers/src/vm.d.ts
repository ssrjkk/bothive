// The pinned @types/node fork omits `resourceLimits` from vm.ScriptOptions even
// though Node has supported it since v11. We set the heap cap at Script
// creation so a runaway script cannot OOM the host process.
declare module 'vm' {
  interface ScriptOptions {
    resourceLimits?: {
      codeGenerationMaxBytes?: number;
      maxOldGenerationSizeMb?: number;
      maxYoungGenerationSizeMb?: number;
      stackSizeMb?: number;
    };
  }
}
