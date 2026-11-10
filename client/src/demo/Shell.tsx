import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { JinnaLogo } from '@/components/ui/logos/logo-jinna';

export const ATTRIBUTION = 'Powered by Meta Muse Ember via OpenRouter.';

/** The pre-login Jinna frame: logo top left, one action top right, content centred on white. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-white">
      <header className="z-20 flex w-full items-center justify-between px-4 py-4 sm:px-6" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <Link to="/" className="flex items-center gap-2 text-black no-underline" aria-label="CheckCheck by Jinna, home">
          <span className="font-inter text-[15px] font-semibold tracking-tight">CheckCheck</span>
          <span className="font-inter text-[13px] text-[#858481]">by</span>
          <JinnaLogo className="h-[15px] text-black" />
        </Link>
        <a
          href="https://jinna.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-9 items-center rounded-full bg-black px-4 font-inter text-xs font-medium text-white no-underline transition-colors hover:bg-gray-800 sm:text-[13px]"
        >
          Try Jinna
        </a>
      </header>
      {children}
      <footer className="z-10 px-4 pb-6 pt-8 text-center font-inter text-xs text-[#858481]" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <p data-testid="attribution">{ATTRIBUTION}</p>
        <p className="mt-1">Public professional information only. Not a background check for hiring, tenancy, credit or insurance decisions.</p>
        <p className="mt-1" data-testid="logging-notice">Requests are logged with your country, without your IP address, to run and improve this demo.</p>
      </footer>
    </div>
  );
}
