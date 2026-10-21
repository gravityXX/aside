// One chain of work that must not overlap (2.9). Each call runs once every call made before it
// has landed, and resolves once its own has, so what is read next holds it. A failure reaches
// its own caller and leaves the calls after it to run, and no call ever waits for a later one,
// which would wait for it. A chain lives as long as the module that made it, and a reload
// starts it over (3.7), as it does the work that asked for it.
export const serial = () => {
  let last: Promise<unknown> = Promise.resolve()

  return <T>(work: () => Promise<T>): Promise<T> => {
    const done = last.then(work)
    last = done.catch(() => undefined)

    return done
  }
}
