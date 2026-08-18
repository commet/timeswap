/** A NEIS key lives only for this browser tab's current work session. */
export function createNeisSession() {
  let key = '';
  return {
    getKey: () => key,
    setKey: (value: string) => {
      key = value.trim();
    },
    clear: () => {
      key = '';
    },
  };
}
