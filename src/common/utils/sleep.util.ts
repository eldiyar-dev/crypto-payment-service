/**
 * Suspends execution for a specified number of milliseconds
 * @param ms - The number of milliseconds to sleep
 * @returns A promise that resolves after the specified delay
 * @example
 * // Sleep for 1 second
 * await sleep(1000);
 */
export const sleep = async (ms: number) => await new Promise((resolver) => setTimeout(() => resolver('OK'), ms))
