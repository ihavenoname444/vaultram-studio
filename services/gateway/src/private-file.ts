import {
  constants,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
} from "node:fs";

// Inspect and read the same descriptor: replacing the path cannot substitute a
// different file between the permission check and read. POSIX-only, fail closed.
export function readPrivateJson(path: string): any {
  let fd: number | undefined;
  try {
    if (!process.getuid || !constants.O_NOFOLLOW)
      throw Error("Unsupported private-file checks");
    fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o077) !== 0 ||
      stat.nlink !== 1 ||
      stat.size < 1 ||
      stat.size > 65536
    )
      throw Error("Unsafe private file");
    return JSON.parse(readFileSync(fd, "utf8"));
  } catch {
    // Neither parse failures nor OS errors may echo credentials or file content.
    throw Error(
      "Private configuration rejected: require an owned, unlinked regular JSON file, owner-only permissions and at most 64 KiB",
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
