import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
	title: 'SUIX5 Intelligence',
	description: 'Read-only SUIX5 market forecast evidence dashboard.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return <html lang="en"><body>{children}</body></html>;
}
