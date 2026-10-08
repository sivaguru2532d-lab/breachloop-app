import { SocConsole } from '@/components/SocConsole';

/**
 * Static shell, dynamic data: the console HTML prerenders (so a cold start
 * serves instantly) while every panel fills itself from `/api/*` in the browser.
 * There is no server-rendered dependency that can fail and blank the page.
 */
export default function Page() {
  return <SocConsole />;
}
