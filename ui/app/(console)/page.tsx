import { redirect } from 'next/navigation';

/** The inbox is the landing page: what needs Roman, and nothing else. */
export default function Home() {
  redirect('/inbox');
}
