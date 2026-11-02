/* The shared SuiX typography is loaded explicitly to match the parent site. */
/* eslint-disable @next/next/no-page-custom-font */
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
	title: 'SUIX5 Intelligence',
	description: 'Read-only SUIX5 market forecast evidence dashboard.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" /><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" /></head><body>{children}</body></html>;
}
