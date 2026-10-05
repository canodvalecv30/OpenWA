import { buildFfmpegArgs, voiceEncodeArgs, videoEncodeArgs } from './ffmpeg';

/**
 * These pin the two things about the argument lists that are load-bearing and easy to break while
 * "tidying": the quoting inside the scale filter, and the codec choices WhatsApp actually requires.
 *
 * The scale quoting is not cosmetic. ffmpeg splits a filter description on commas, so the comma
 * inside `if()` or `min()` terminates the filter unless the expression is quoted — the unquoted form
 * fails to parse (`scale=min(1280,iw)` gave `Invalid size 'min(1280'`). Because these arguments
 * are passed through spawn rather than a shell, the quotes have to be part of the string itself; a
 * reviewer removing them as redundant shell syntax would break every video conversion, and nothing
 * else here would notice.
 */
describe('ffmpeg encoder arguments', () => {
  /** Read `-flag value` out of an argv array, so assertions do not depend on argument order. */
  const valueOf = (args: string[], flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };

  describe('voice', () => {
    const args = voiceEncodeArgs();

    // Ogg/Opus is what makes a WhatsApp client render a playable mic bubble rather than a file.
    it('encodes Opus', () => {
      expect(valueOf(args, '-c:a')).toBe('libopus');
    });

    it('drops any video stream, so converting a video yields audio only', () => {
      expect(args).toContain('-vn');
    });

    // Mono at 48 kHz with the voip tuning is what the app's own recorder produces.
    it('produces mono 48 kHz tuned for speech', () => {
      expect(valueOf(args, '-ac')).toBe('1');
      expect(valueOf(args, '-ar')).toBe('48000');
      expect(valueOf(args, '-application')).toBe('voip');
    });
  });

  describe('video', () => {
    const args = videoEncodeArgs();

    // Baseline + yuv420p is the pairing that plays on every WhatsApp client, including older Android.
    it('encodes baseline H.264 with a widely playable pixel format', () => {
      expect(valueOf(args, '-c:v')).toBe('libx264');
      expect(valueOf(args, '-profile:v')).toBe('baseline');
      expect(valueOf(args, '-pix_fmt')).toBe('yuv420p');
    });

    it('moves the index to the front so playback can start before the file finishes arriving', () => {
      expect(valueOf(args, '-movflags')).toBe('+faststart');
    });

    // Unquoted, ffmpeg reads the filter as `scale=min(iw`. The frame is fitted inside 1280x720 (or
    // 720x1280), which keeps every aspect ratio within the Baseline 3.1 frame size the stream declares:
    // capping only the longer edge left a square 1080x1080 or a 4:3 1280x960 frame above it. Both
    // edges are kept even, which H.264 requires (an odd 499x281 GIF is refused by libx264).
    it('quotes the scale expressions, fits the frame within level 3.1 and keeps both edges even', () => {
      expect(valueOf(args, '-level')).toBe('3.1');
      expect(valueOf(args, '-vf')).toBe(
        "scale='min(iw,if(gte(iw,ih),1280,720))':'min(ih,if(gte(iw,ih),720,1280))'" +
          ':force_original_aspect_ratio=decrease:force_divisible_by=2',
      );
    });

    // Level 3.1 also caps the macroblock rate, which is 1280x720 at 30 fps: a 60 fps phone clip kept
    // its rate and declared a level it exceeded. `-fpsmax` lowers a faster rate and leaves a slower one.
    it('caps the frame rate at the 30 fps level 3.1 allows for a 720p frame', () => {
      expect(valueOf(args, '-fpsmax')).toBe('30');
    });
  });
});

/**
 * ffmpeg resolves its input as a URL, and left unrestricted it will make the request: pointed at an
 * `http://` address it reaches the network, which on a cloud host includes the link-local metadata
 * endpoint. The input here is always a file this process just wrote, so confining ffmpeg to the file
 * protocol costs nothing and removes the class entirely. Losing that flag would be invisible —
 * every conversion would still succeed — which is exactly why it is pinned here.
 */
describe('ffmpeg invocation shape', () => {
  const args = buildFfmpegArgs(
    '/tmp/openwa-convert-x/in.bin',
    '/tmp/openwa-convert-x/out.ogg',
    ['-c:a', 'libopus'],
    1000,
  );

  // Without it the size cap is only checked after ffmpeg exits, and until then the output can grow
  // without bound in the temp directory. It must be an output option: before -i it would apply to the
  // input, after the output path ffmpeg ignores it.
  it('caps the output size one byte above the limit, as an output option', () => {
    const at = args.indexOf('-fs');
    expect(args[at + 1]).toBe('1001');
    expect(at).toBeGreaterThan(args.indexOf('libopus'));
    expect(at).toBe(args.length - 3);
  });

  // ffmpeg parses -fs as a signed 64-bit integer and exits 1 on anything wider, so a row-of-nines cap
  // meant as "unlimited" would fail every conversion instead.
  it('keeps the size cap within what ffmpeg accepts, however large the configured limit', () => {
    for (const limit of [Number('99999999999999999999'), 1e21]) {
      const huge = buildFfmpegArgs('/in', '/out', [], limit);
      expect(huge[huge.indexOf('-fs') + 1]).toBe(String(Number.MAX_SAFE_INTEGER));
    }
  });

  it('confines ffmpeg to the file protocol', () => {
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file');
  });

  // The file protocol still reaches local files, and playlist or manifest demuxers open the files
  // their input names. Only single-file containers may decode the input, and the whitelist has to be
  // an input option, so it must precede -i.
  it('restricts the input demuxers to single-file media containers', () => {
    const at = args.indexOf('-format_whitelist');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(args.indexOf('-i'));
    const formats = args[at + 1].split(',');
    expect(formats).toEqual(
      expect.arrayContaining(['mov', 'matroska', 'ogg', 'mp3', 'wav', 'gif', 'mpeg', 'ac3', 'eac3']),
    );
    for (const referencing of ['hls', 'dash', 'concat', 'image2', 'segment', 'tee', 'lavfi']) {
      expect(formats).not.toContain(referencing);
    }
  });

  it('never waits on stdin, and never prompts about an existing output', () => {
    expect(args).toContain('-nostdin');
    expect(args).toContain('-y');
  });

  it('names the input immediately after -i, and the output last', () => {
    expect(args[args.indexOf('-i') + 1]).toBe('/tmp/openwa-convert-x/in.bin');
    expect(args[args.length - 1]).toBe('/tmp/openwa-convert-x/out.ogg');
  });

  // Encoder flags have to land between the input and the output; ffmpeg applies options positionally,
  // so an encoder flag placed before -i would be read as an INPUT option and silently do nothing.
  it('places encoder arguments between the input and the output', () => {
    expect(args.indexOf('-c:a')).toBeGreaterThan(args.indexOf('-i'));
    expect(args.indexOf('-c:a')).toBeLessThan(args.length - 1);
  });
});
