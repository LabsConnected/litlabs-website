import PricingClient from "./PricingClient";

export default function PricingPage() {
  const founderAvailable = !!process.env.STRIPE_PRICE_FOUNDER;
  return <PricingClient founderAvailable={founderAvailable} />;
}
