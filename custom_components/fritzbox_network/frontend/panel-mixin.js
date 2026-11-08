/** Adds the methods of a class to the prototype of another one, as if they had been written in it. */
export function mixin(target, source) {
  for (const name of Object.getOwnPropertyNames(source.prototype)) {
    if (name === "constructor") continue;
    Object.defineProperty(target.prototype, name, Object.getOwnPropertyDescriptor(source.prototype, name));
  }
}
