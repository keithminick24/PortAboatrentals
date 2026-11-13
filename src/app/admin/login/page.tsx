import LoginForm from "./LoginForm";

export const metadata = { title: "Staff sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-xl font-bold tracking-wide text-white">PORT A BOAT RENTALS</div>
        <LoginForm next={next ?? "/admin"} />
      </div>
    </div>
  );
}
