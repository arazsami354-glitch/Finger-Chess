import { PublicNavbar } from '@/components/layout/public-navbar';
import { Hero } from '@/components/landing/hero';
import { Features } from '@/components/landing/features';
import { Stakes } from '@/components/landing/stakes';
import { ClosingCta, Footer } from '@/components/landing/cta-footer';

export default function LandingPage() {
  return (
    <>
      <PublicNavbar />
      <Hero />
      <Features />
      <Stakes />
      <ClosingCta />
      <Footer />
    </>
  );
}
