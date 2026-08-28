import { pick, keepLocalCopy, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';

// Mirrors selectPhoneAudio() from the original HTML. The original used
// <input type="file"> + a Blob/ObjectURL kept in memory (lost on reload).
// Here, we end up with a stable file in our own known subfolder that
// survives app restarts — so pinned sessions can just store the filename
// and it'll still be valid next time the app launches.

const GUIDE_AUDIO_DIR = `${RNFS.DocumentDirectoryPath}/guideAudio`;

const MIME_EXT_MAP = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
};

// AVAudioPlayer relies on the file extension (or an explicit type hint we
// don't have here) to recognize the audio format. `name`/`type` from the
// picker can both be null depending on the document provider — if we ever
// fall back to an extensionless filename, the copied file fails to load
// with a generic "unsupported file type" error (OSStatus 'wht?') even
// though the underlying bytes are a perfectly valid MP3.
function ensureExtension(name, mimeType) {
  if (name && /\.[a-zA-Z0-9]+$/.test(name)) {
    return name; // already has a usable extension
  }
  const ext = (mimeType && MIME_EXT_MAP[mimeType.toLowerCase()]) || 'mp3';
  return `${name || 'guide-audio'}.${ext}`;
}

async function ensureGuideAudioDir() {
  const exists = await RNFS.exists(GUIDE_AUDIO_DIR);
  if (!exists) await RNFS.mkdir(GUIDE_AUDIO_DIR);
}

export async function pickGuideAudioFile() {
  let results;
  try {
    results = await pick({ type: [types.audio] });
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) {
      return null; // user cancelled — not an error
    }
    throw e;
  }

  const result = results[0];
  const safeFileName = ensureExtension(result.name, result.type);
  console.log('pickGuideAudioFile: picked', {
    name: result.name,
    type: result.type,
    size: result.size,
    resolvedFileName: safeFileName,
  });

  // keepLocalCopy places the file under Documents/<random-UUID>/filename —
  // a fresh, unpredictable UUID subfolder on every single call. That means
  // we can't reconstruct this path later from just the filename, so we
  // immediately relocate it into our own fixed, predictable subfolder
  // instead of trusting keepLocalCopy's placement.
  const copies = await keepLocalCopy({
    files: [{ uri: result.uri, fileName: safeFileName }],
    destination: 'documentDirectory',
  });
  const copy = copies[0];
  if (copy.status !== 'success') {
    throw new Error(copy.copyError || 'Could not save the selected audio file.');
  }
  console.log('pickGuideAudioFile: copied to', copy.localUri);

  await ensureGuideAudioDir();
  const sourcePlainPath = decodeURIComponent(copy.localUri.replace('file://', ''));
  const finalPlainPath = `${GUIDE_AUDIO_DIR}/${safeFileName}`;

  // Clear out any previous file at this exact name first — moveFile can
  // fail if the destination already exists.
  if (await RNFS.exists(finalPlainPath)) {
    await RNFS.unlink(finalPlainPath);
  }
  await RNFS.moveFile(sourcePlainPath, finalPlainPath);
  console.log('pickGuideAudioFile: relocated to', finalPlainPath);

  // Store just the filename — GUIDE_AUDIO_DIR is a fixed, known subfolder
  // (unlike keepLocalCopy's random one), and RNFS.DocumentDirectoryPath
  // always reflects the CURRENT app install, so resolveGuideAudioPath()
  // can reconstruct the right absolute path even after a reinstall changes
  // the app container's UUID.
  return { name: result.name || safeFileName, path: safeFileName };
}

// Reconstructs the current absolute path for a stored guide-audio filename.
// Always use this at the point of actual file access (playback, deletion,
// existence checks) rather than persisting/passing around an absolute path.
//
// Also handles values saved before this fix existed, when the stored value
// was a full file:// URI/path rather than a bare filename (which would have
// gone stale on reinstall anyway) — extracts just the basename so already-
// saved pinned sessions recover instead of failing in a new way. Old-format
// files won't actually be found (they were never moved into GUIDE_AUDIO_DIR),
// so those specific pinned sessions will still need the file re-selected once.
export function resolveGuideAudioPath(fileName) {
  if (!fileName) return null;
  const basename = fileName.includes('/') ? decodeURIComponent(fileName.split('/').pop()) : fileName;
  return `${GUIDE_AUDIO_DIR}/${basename}`;
}

export async function deleteGuideAudioFile(fileName) {
  if (!fileName) return;
  try {
    const absPath = resolveGuideAudioPath(fileName);
    const exists = await RNFS.exists(absPath);
    if (exists) await RNFS.unlink(absPath);
  } catch (e) {
    console.warn('deleteGuideAudioFile failed', e);
  }
}
