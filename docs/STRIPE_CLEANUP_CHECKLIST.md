# Stripe Cleanup Checklist — Legacy Memberships

> Owner-side Stripe dashboard actions. No code changes required.
> Do NOT cancel existing customers automatically.

## Legacy Products to Archive

These four old membership products are not part of the current product truth.
They should no longer accept new purchases.

| Product | Price | Action |
|---|---|---|
| LiTTree-LabStudios Basic Membership | $9.99/month | Archive |
| LiTTree-LabStudios Elite Membership | $39/month | Archive |
| LiTTree-LabStudios Starter Membership | $5/month | Archive |
| LiTTree-LabStudios Pro Membership | $19.99/month | Archive |

## Pre-Archive Steps

For each legacy product:

1. **Check active subscriptions** — Identify customers currently subscribed
   using each legacy Price. Export the list for records.

2. **Check active Payment Links** — Identify any Payment Links that reference
   these Prices. Deactivate them.

3. **Export product and Price records** — Save a copy of the product and
   Price details for your records before archiving.

4. **Document grandfathered customers** — Record which customers are on
   legacy plans and whether they will be grandfathered or migrated.

## Archive Steps

5. **Archive legacy Prices** — Archive each Price so no new customer can
   select it. Existing subscriptions continue until canceled.

6. **Archive products** — After confirming nothing current references them,
   archive the products.

## Post-Archive

7. **Do NOT automatically cancel or migrate existing customers.** Anyone
   already subscribed should either be grandfathered temporarily or migrated
   through an explicit customer-approved process.

8. **Do NOT reference legacy products in code, pricing, checkout, SEO,
   metadata, or documentation.**

## Important Notes

- Stripe does not allow deleting products or Prices — only archiving.
- Archived Prices cannot be used for new purchases but continue to work
  for existing subscriptions.
- No Stripe dashboard changes are authorized from the code agent. All
  actions in this checklist must be performed by the owner in the Stripe
  dashboard.
