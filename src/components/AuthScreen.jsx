import AuthForm from './AuthForm.jsx';

// Shown whenever there is no signed-in user. The Studio itself never renders
// until App.jsx sees a session.
export default function AuthScreen() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-black/10 bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-center px-4 py-4">
          <span className="text-sm font-semibold tracking-[0.25em] uppercase">
            Virtual Try-On
          </span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <AuthForm />
      </main>
    </div>
  );
}
