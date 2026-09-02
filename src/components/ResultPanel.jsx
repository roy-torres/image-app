import Spinner from './Spinner.jsx';

export default function ResultPanel({
  loading,
  error,
  resultUrl,
  imgLoaded,
  onImgLoad,
  onImgError,
}) {
  if (!loading && !error && !resultUrl) return null;

  return (
    <section className="mx-auto mt-10 w-full max-w-xl">
      <h2 className="mb-3 text-center text-sm font-semibold tracking-wide uppercase text-black/60">
        Result
      </h2>

      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Spinner />
            <p className="text-sm text-black/60">Generating…</p>
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && resultUrl && (
          <div className="space-y-4">
            <div className="flex items-center justify-center overflow-hidden rounded-xl border border-black/10 bg-canvas">
              <img
                src={resultUrl}
                alt="Generated try-on result"
                onLoad={onImgLoad}
                onError={onImgError}
                className="max-h-[70vh] w-full object-contain"
              />
            </div>
            {imgLoaded && (
              <a
                href={resultUrl}
                download="generated-image.png"
                className="block w-full rounded-full bg-black px-6 py-3 text-center text-sm font-medium text-white transition hover:bg-black/85"
              >
                Download Image
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
