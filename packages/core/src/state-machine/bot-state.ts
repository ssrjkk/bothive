export enum BotState {
  Idle = 'idle',
  Connecting = 'connecting',
  Running = 'running',
  Paused = 'paused',
  Error = 'error',
  Reconnecting = 'reconnecting',
  Disconnecting = 'disconnecting',
  Removed = 'removed',
}

export enum BotTransition {
  Start = 'start',
  Stop = 'stop',
  Pause = 'pause',
  Resume = 'resume',
  Connect = 'connect',
  Disconnect = 'disconnect',
  Fail = 'fail',
  Reconnect = 'reconnect',
  Remove = 'remove',
  Timeout = 'timeout',
}

type TransitionMap = Partial<Record<BotTransition, BotState>>;

const transitions: Record<BotState, TransitionMap> = {
  [BotState.Idle]: {
    [BotTransition.Start]: BotState.Connecting,
    [BotTransition.Connect]: BotState.Connecting,
    [BotTransition.Remove]: BotState.Removed,
  },
  [BotState.Connecting]: {
    [BotTransition.Connect]: BotState.Running,
    [BotTransition.Fail]: BotState.Error,
    [BotTransition.Timeout]: BotState.Error,
    [BotTransition.Stop]: BotState.Idle,
  },
  [BotState.Running]: {
    [BotTransition.Stop]: BotState.Idle,
    [BotTransition.Pause]: BotState.Paused,
    [BotTransition.Fail]: BotState.Error,
    [BotTransition.Disconnect]: BotState.Idle,
    [BotTransition.Reconnect]: BotState.Reconnecting,
  },
  [BotState.Paused]: {
    [BotTransition.Resume]: BotState.Running,
    [BotTransition.Stop]: BotState.Idle,
    [BotTransition.Fail]: BotState.Error,
  },
  [BotState.Error]: {
    [BotTransition.Reconnect]: BotState.Reconnecting,
    [BotTransition.Start]: BotState.Connecting,
    [BotTransition.Resume]: BotState.Connecting,
    [BotTransition.Stop]: BotState.Idle,
    [BotTransition.Remove]: BotState.Removed,
  },
  [BotState.Reconnecting]: {
    [BotTransition.Connect]: BotState.Running,
    [BotTransition.Fail]: BotState.Error,
    [BotTransition.Stop]: BotState.Idle,
    [BotTransition.Timeout]: BotState.Error,
  },
  [BotState.Disconnecting]: {
    [BotTransition.Disconnect]: BotState.Idle,
    [BotTransition.Fail]: BotState.Error,
  },
  [BotState.Removed]: {},
};

export function canTransition(from: BotState, transition: BotTransition): boolean {
  const map = transitions[from];
  return map !== undefined && transition in map;
}

export function applyTransition(from: BotState, transition: BotTransition): BotState {
  const map = transitions[from];
  if (map === undefined) {
    throw new Error(`Unknown state ${from}`);
  }
  const next = map[transition];
  if (next === undefined) {
    throw new Error(`Invalid transition ${transition} from state ${from}`);
  }
  return next;
}

export function getValidTransitions(state: BotState): BotTransition[] {
  const map = transitions[state];
  if (map === undefined) return [];
  return Object.keys(map) as BotTransition[];
}

export class BotStateMachine {
  private state: BotState = BotState.Idle;
  private listeners: Map<BotTransition, Array<(from: BotState, to: BotState) => Promise<void>>> = new Map();

  constructor(initialState: BotState = BotState.Idle) {
    this.state = initialState;
  }

  get currentState(): BotState {
    return this.state;
  }

  can(transition: BotTransition): boolean {
    return canTransition(this.state, transition);
  }

  on(transition: BotTransition, handler: (from: BotState, to: BotState) => Promise<void>): void {
    if (!this.listeners.has(transition)) {
      this.listeners.set(transition, []);
    }
    this.listeners.get(transition)!.push(handler);
  }

  async dispatch(transition: BotTransition): Promise<BotState> {
    if (!this.can(transition)) {
      throw new Error(`Cannot transition from ${this.state} via ${transition}`);
    }

    const from = this.state;
    const to = applyTransition(from, transition);

    console.log(`[StateMachine] ${from} --(${transition})--> ${to}`);

    this.state = to;
    const handlers = this.listeners.get(transition) ?? [];
    await Promise.all(
      handlers.map((h) =>
        Promise.resolve(h(from, to)).catch((err) => {
          console.error(`[StateMachine] Listener error on ${from} --(${transition})--> ${to}:`, err);
        }),
      ),
    );

    return to;
  }

  reset(state: BotState = BotState.Idle): void {
    this.state = state;
  }

  isActive(): boolean {
    return this.state === BotState.Running || this.state === BotState.Connecting;
  }

  isStopped(): boolean {
    return this.state === BotState.Idle || this.state === BotState.Removed;
  }

  isFailed(): boolean {
    return this.state === BotState.Error;
  }
}
