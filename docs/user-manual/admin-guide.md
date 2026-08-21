# Channel Admin Guide

This guide covers the **miniapp Admin Panel** — the WeChat Mini Program page for admins scoped to a single channel. Open it from the menu (tap the header/logo) → **Channel Admin**. This is separate from the web-based Super Admin Panel, which is out of scope for this guide.

Access requires the `admin` role, scoped to your channel — you only see and manage data belonging to your own channel.

## Contents

1. [Overview](#overview)
2. [Dashboard](#dashboard)
3. [Managing Users](#managing-users)
4. [Managing Coaches](#managing-coaches)
5. [Managing the Store](#managing-the-store)
6. [Managing Orders](#managing-orders)
7. [Invite Codes](#invite-codes)
8. [Rewards & Coach Payouts](#rewards--coach-payouts)
9. [Partners](#partners)
10. [The Kino Simulator](#the-kino-simulator)

---

## Overview

The Admin Panel has tabs for **Dashboard**, **Users**, **Coaches**, **Store**, **Invites**, **Rewards**, and **Partners**. Everything shown and edited here is scoped to your own channel.

## Dashboard

A quick overview of your channel: total users, number of coaches, new users in the last 7 days, and orders placed this month.

## Managing Users

The **Users** tab lists everyone in your channel. Tap a user to view their profile and latest biomarkers. Use **Add** to create a new user directly, or **Edit** to update a user's nickname, gender, date of birth, language, assigned coach, phone, email, and external app/ID fields (for users onboarded through a channel other than WeChat, e.g. WhatsApp).

**Deleting a user** permanently removes their test records and notifications along with the account. If a user holds additional roles (coach, admin, superadmin), you'll need to remove those roles in the Super Admin panel before you can delete them here.

## Managing Coaches

The **Coaches** tab lists coaches in your channel, showing how many users each one has. **Add** links an existing user account to the coach role; **Edit** updates their contact details and language. **Deleting** a coach un-assigns their users (the users remain, just unassigned) rather than deleting the users themselves.

## Managing the Store

Under the **Store** tab's **Products** sub-tab, you manage the catalog: a SKU/key, English and Chinese names, pricing (CNY and USD), an optional tag (Best Seller / Value), a unit label, English/Chinese descriptions, sort order, and whether the item is active/visible in the store. **Add**, **Edit**, or **Delete** products as needed (deletion is permanent).

## Managing Orders

Under the **Store** tab's **Orders** sub-tab, review every order placed in your channel — customer, item, quantity, price, and status. Update an order's status (Pending → Confirmed → Shipped → Delivered, or Cancelled) as fulfillment progresses.

## Invite Codes

The **Invites** tab lets you generate invite codes for your channel. If your channel has coaches, you'll be asked whether the invite is general (unassigned) or tied to a specific coach. Copy an invite's link to share it, or deactivate one to invalidate any copies already sent out.

## Rewards & Coach Payouts

The **Rewards** tab shows your channel's earnings for the current month and a per-coach commission breakdown. From here you can **Generate Coach Payouts** for a period, then move each payout through its lifecycle — approve it, then mark it as transferred once paid. A separate section lists referral records (who referred whom, and the resulting commission).

## Partners

The **Partners** tab manages partner accounts tied to your channel — assign a user as a partner, set their tier (Bronze/Silver/Gold/Platinum) and status (active/inactive), and add notes. As with coaches, **Generate Payouts** creates a settlement batch you can approve and mark as transferred. A running total of commissions is shown per partner.

## The Kino Simulator

Available to admins and superadmins from the main menu ("Kino Simulator," password-protected). This simulates a physical Kino chip scan and analysis end-to-end — useful for demos, testing, or troubleshooting without a physical Kino Analyzer device on hand. It walks through the same registration → analysis → results flow real users see when scanning a chip, showing the resulting BioAge and biomarker breakdown for the selected patient.
