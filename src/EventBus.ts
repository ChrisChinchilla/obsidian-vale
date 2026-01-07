import { debug } from "./debug";

type EventType =
  | "ready"
  | "check"
  | "select-alert"
  | "deselect-alert"
  | "alerts";

// The main purpose of the event bus is to issue commands to the React
// application.
export class EventBus {
  private subscribers: Record<string, (msg: unknown) => void>;

  constructor() {
    this.subscribers = {};
  }

  on(topic: EventType, cb: (msg: unknown) => void): () => void {
    debug(`Registering subscriber for topic "${topic}"`);
    this.subscribers[topic] = cb;

    return () => {
      debug(`Unregistering subscriber for topic "${topic}"`);
      delete this.subscribers[topic];
    };
  }

  dispatch<T>(topic: string, msg: T): void {
    debug(`Dispatched event on topic "${topic}"`);

    const cb = this.subscribers[topic];
    if (cb) {
      cb(msg);
    } else {
      console.warn("Dispatched event has no subscriber:", topic);
    }
  }
}
