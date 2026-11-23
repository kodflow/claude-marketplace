// fspath.ts — one key per file for the in-memory hosts, on every platform.
//
// The engine resolves a `$.fs` path with the host's own rules before a
// test's hook sees it: on Windows "/cfg/x" arrives as "C:\cfg\x", and on
// macOS or Linux a drive path the mod builds ("C:/Profiles/dev/x", a Windows
// HOME) is relative, so it arrives under the working directory. A command's
// argv is never resolved. Both are folded to the POSIX spelling the tests
// write: backslashes to slashes, everything up to a drive dropped.
export const px = (p: string): string =>
  typeof p === "string"
    ? p.replace(/\\/g, "/").replace(/^(?:.*\/)?[A-Za-z]:\//, "/")
    : p;
