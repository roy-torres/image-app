import { useCallback, useEffect, useRef, useState } from 'react';
import ImageUploader from './components/ImageUploader.jsx';
import ResultPanel from './components/ResultPanel.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import Paywall from './components/Paywall.jsx';
import Spinner from './components/Spinner.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { generateImage } from './lib/generateImage.js';
import { prepareImage } from './lib/prepareImage.js';
import { STRIPE_BILLING_PORTAL_URL } from './config.js';

const EMPTY_SLOT = { file: null, previewUrl: '', error: '' };

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

// Accept anything the browser tags as an image; fall back to the file extension
// for sources that don't set a MIME type (some drag-and-drop / extension-less files).
function isImageFile(file) {
  return file.type ? file.type.startsWith('image/') : IMAGE_EXT.test(file.name);
}

export default function App() {
  const { loading: authLoading, session, isPaid, displayName, signOut } = useAuth();

  const [subject, setSubject] = useState(EMPTY_SLOT);
  const [attribute, setAttribute] = useState(EMPTY_SLOT);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState({ url: '', isObjectUrl: false });
  const [imgLoaded, setImgLoaded] = useState(false);

  const abortRef = useRef(null);

  // Revoke object URLs when they change or the component unmounts.
  useEffect(() => {
    return () => {
      if (subject.previewUrl) URL.revokeObjectURL(subject.previewUrl);
    };
  }, [subject.previewUrl]);

  useEffect(() => {
    return () => {
      if (attribute.previewUrl) URL.revokeObjectURL(attribute.previewUrl);
    };
  }, [attribute.previewUrl]);

  useEffect(() => {
    return () => {
      if (result.isObjectUrl && result.url) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const makeSelectHandler = useCallback(
    (setSlot) => (file) => {
      if (!isImageFile(file) || /svg/i.test(file.type)) {
        setSlot((prev) => {
          if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
          return {
            ...EMPTY_SLOT,
            error: 'Choose a raster image — PNG, JPG, or WebP.',
          };
        });
        return;
      }
      setSlot((prev) => {
        if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return { file, previewUrl: URL.createObjectURL(file), error: '' };
      });
    },
    [],
  );

  const makeClearHandler = useCallback(
    (setSlot) => () => {
      setSlot((prev) => {
        if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return EMPTY_SLOT;
      });
    },
    [],
  );

  const handleSelectSubject = makeSelectHandler(setSubject);
  const handleSelectAttribute = makeSelectHandler(setAttribute);
  const handleClearSubject = makeClearHandler(setSubject);
  const handleClearAttribute = makeClearHandler(setAttribute);

  const canGenerate = Boolean(subject.file && attribute.file) && !loading;

  async function handleGenerate() {
    if (!canGenerate) return;

    setError('');
    setImgLoaded(false);
    setResult((prev) => {
      if (prev.isObjectUrl && prev.url) URL.revokeObjectURL(prev.url);
      return { url: '', isObjectUrl: false };
    });
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const [prepared1, prepared2] = await Promise.all([
        prepareImage(subject.file),
        prepareImage(attribute.file),
      ]);
      const next = await generateImage(prepared1, prepared2, controller.signal);
      setResult(next);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setError(err?.message || 'Something went wrong while generating the image.');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  function handleReset() {
    abortRef.current?.abort();
    abortRef.current = null;
    setSubject((prev) => {
      if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return EMPTY_SLOT;
    });
    setAttribute((prev) => {
      if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return EMPTY_SLOT;
    });
    setResult((prev) => {
      if (prev.isObjectUrl && prev.url) URL.revokeObjectURL(prev.url);
      return { url: '', isObjectUrl: false };
    });
    setError('');
    setLoading(false);
    setImgLoaded(false);
  }

  if (authLoading || (session && isPaid === null)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (!isPaid) {
    return <Paywall />;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-black/10 bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <span className="text-sm font-semibold tracking-[0.25em] uppercase">
            Virtual Try-On
          </span>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-black/55 sm:inline">{displayName}</span>
            {STRIPE_BILLING_PORTAL_URL && (
              <a
                href={STRIPE_BILLING_PORTAL_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-black/20 px-4 py-1.5 font-medium transition hover:bg-black/5"
              >
                Manage billing
              </a>
            )}
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded-full border border-black/20 px-4 py-1.5 font-medium transition hover:bg-black/5"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold sm:text-3xl">Virtual Try-On Studio</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-black/55">
            Upload a subject and an attribute image, then generate a combined result.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <ImageUploader
            title="Subject"
            hint="A person or model"
            previewUrl={subject.previewUrl}
            fileName={subject.file?.name}
            error={subject.error}
            disabled={loading}
            onSelect={handleSelectSubject}
            onClear={handleClearSubject}
          />
          <ImageUploader
            title="Attribute"
            hint="Clothing or an accessory"
            previewUrl={attribute.previewUrl}
            fileName={attribute.file?.name}
            error={attribute.error}
            disabled={loading}
            onSelect={handleSelectAttribute}
            onClear={handleClearAttribute}
          />
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="rounded-full bg-black px-7 py-3 text-sm font-medium text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? 'Generating…' : 'Generate'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={loading}
            className="rounded-full border border-black/20 px-7 py-3 text-sm font-medium transition hover:bg-black/5 disabled:opacity-40"
          >
            Reset
          </button>
        </div>

        {!canGenerate && !loading && !(subject.file && attribute.file) && (
          <p className="mt-3 text-center text-xs text-black/45">
            Upload both images to enable Generate.
          </p>
        )}

        <ResultPanel
          loading={loading}
          error={error}
          resultUrl={result.url}
          imgLoaded={imgLoaded}
          onImgLoad={() => setImgLoaded(true)}
          onImgError={() => {
            setImgLoaded(false);
            setError('The generated image could not be displayed.');
            setResult((prev) => {
              if (prev.isObjectUrl && prev.url) URL.revokeObjectURL(prev.url);
              return { url: '', isObjectUrl: false };
            });
          }}
        />
      </main>

      <footer className="mx-auto max-w-5xl px-4 pb-10 text-center text-xs text-black/35">
        Images are resized in your browser and sent to the server only for processing.
      </footer>
    </div>
  );
}
