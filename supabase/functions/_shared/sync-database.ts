// Fail any sync step on a database error, including helpers that ignore `error`.
export function checkedDatabase<T extends object>(client: T): T {
  const wrap = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    return new Proxy(value, {
      get(target, property) {
        if (property === "then" && typeof Reflect.get(target, "then") === "function") {
          return (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(target).then((result: unknown) => {
            if (result && typeof result === "object" && "error" in result && result.error) throw result.error;
            return result;
          }).then(resolve, reject);
        }
        const member = Reflect.get(target, property);
        return typeof member === "function" ? (...args: unknown[]) => wrap(member.apply(target, args)) : wrap(member);
      },
    });
  };
  return wrap(client) as T;
}
