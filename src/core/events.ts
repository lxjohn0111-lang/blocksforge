type Handler<T> = (payload: T) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  private map = new Map<keyof Events, Set<Handler<any>>>();
  on<K extends keyof Events>(k: K, h: Handler<Events[K]>): () => void {
    let s = this.map.get(k);
    if (!s) {
      s = new Set();
      this.map.set(k, s);
    }
    s.add(h);
    return () => s!.delete(h);
  }
  emit<K extends keyof Events>(k: K, payload: Events[K]) {
    const s = this.map.get(k);
    if (!s) return;
    for (const h of [...s]) h(payload);
  }
  clear() {
    this.map.clear();
  }
}
