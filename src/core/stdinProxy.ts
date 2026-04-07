/**
 * Stdin proxy for raw mode compatibility
 * 
 * When stdin is piped (e.g., from the launcher for mouse filtering), Ink cannot
 * call setRawMode() on the piped stream. This proxy wraps stdin and makes
 * setRawMode() a no-op, since the parent process already set raw mode.
 * 
 * All other stream methods and properties are passed through transparently.
 */

type StdinType = typeof process.stdin;

export function createRawModeProxy(stdin: StdinType): StdinType {
  return new Proxy(stdin, {
    get(target, prop, receiver) {
      if (prop === "setRawMode") {
        // Parent process already set raw mode on the actual TTY
        // Return a no-op function that returns true (success)
        return () => true;
      }
      
      // Mock isTTY for Ink's isRawModeSupported() check
      if (prop === "isTTY") {
        return true;
      }
      
      // Pass through all other properties and methods
      const value = Reflect.get(target, prop, receiver);
      
      // Bind functions to the original target to preserve 'this' context
      if (typeof value === "function") {
        return value.bind(target);
      }
      
      return value;
    },
  }) as StdinType;
}
