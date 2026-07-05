// Hands a just-captured photo URI from the camera screen back to the
// Import index screen across a router.back() navigation. Route params
// would work too, but a plain module-level slot is simpler than
// serializing/deserializing through the URL for a single local file URI
// that's only ever read once, immediately, by the screen that pushed the
// camera route.
let pendingUri: string | null = null;

export function setPendingCapture(uri: string) {
  pendingUri = uri;
}

export function consumePendingCapture(): string | null {
  const uri = pendingUri;
  pendingUri = null;
  return uri;
}
