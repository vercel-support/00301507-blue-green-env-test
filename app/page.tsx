import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const reqHeaders = headers();
  return (
    <div>
      <pre>{JSON.stringify(Array.from(reqHeaders.entries()), null, 2)}</pre>
    </div>
  );
}
