/* Voltaro cloud client: auth + database, initialized once from publicConfig. */
(function () {
  const cfg = window.VOLTARO_PUBLIC_CONFIG;
  if (!cfg || !window.WorkBuddyCloud) {
    window.VOLTARO_CLOUD_ERROR = "Cloud SDK or configuration is missing";
    return;
  }

  const cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: cfg.endpoint,
    oauthRelayBaseUrl: cfg.oauthRelayBaseUrl,
    publishableKey: cfg.publishableKey,
  });
  window.VOLTARO_CLOUD = cloud;

  let pendingEmailOtp = null;

  function normalizeProduct(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      price: Number(row.price),
      was: row.was == null ? null : Number(row.was),
      rating: Number(row.rating),
      reviews: Number(row.reviews),
      badge: row.badge || null,
      image: row.image,
      short: row.short,
      features: Array.isArray(row.features) ? row.features : [],
    };
  }

  async function requireSession() {
    const { data: session, error } = await cloud.auth.getSession();
    if (error || !session) {
      const err = new Error("Sign in required");
      err.code = "SIGN_IN_REQUIRED";
      throw err;
    }
    return session;
  }

  window.VOLTARO_AUTH = {
    async getSession() {
      const { data: session, error } = await cloud.auth.getSession();
      return { session, error };
    },

    async getUser() {
      return cloud.auth.getUser();
    },

    async sendEmailCode(email) {
      const clean = String(email || "").trim().toLowerCase();
      if (!clean) throw new Error("Enter your email address first");
      const sent = await cloud.auth.sendOtp({ email: clean });
      if (sent.error) throw sent.error;
      pendingEmailOtp = {
        email: clean,
        verificationId: sent.data.verificationId,
        isExistingUser: sent.data.isExistingUser,
      };
      return pendingEmailOtp;
    },

    async verifyEmailCode(email, token) {
      const clean = String(email || "").trim().toLowerCase();
      const code = String(token || "").trim();
      const pending = pendingEmailOtp;
      if (!pending || pending.email !== clean) {
        throw new Error("Get a verification code for this email first");
      }
      if (!code) throw new Error("Enter the verification code");
      const completed = await cloud.auth.verifyOtp({
        email: pending.email,
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: code,
      });
      if (completed.error) throw completed.error;
      pendingEmailOtp = null;
      return completed.data;
    },

    async signOut() {
      return cloud.auth.signOut();
    },
  };

  window.VOLTARO_DB = {
    async getProducts() {
      const { data, error } = await cloud.database
        .from("products")
        .select("*")
        .eq("active", true)
        .order("reviews", { ascending: false });
      if (error) throw error;
      return (data || []).map(normalizeProduct);
    },

    async subscribe(email, source) {
      const { error } = await cloud.database
        .from("newsletter_subscribers")
        .insert({ email: email.trim().toLowerCase(), source: source || "homepage" });
      if (error) {
        if (error.code === "23505") return { already: true };
        throw error;
      }
      return { already: false };
    },

    /* ---------- Profile ---------- */
    async getProfile() {
      await requireSession();
      const { data, error } = await cloud.database.from("user_profiles").select("*").maybeSingle();
      if (error) throw error;
      return data || null;
    },

    async saveProfile(profile) {
      await requireSession();
      const { data, error } = await cloud.database
        .from("user_profiles")
        .upsert(
          {
            email: profile.email || null,
            name: profile.name || null,
            country: profile.country || null,
            phone: profile.phone || null,
            newsletter_opt_in: !!profile.newsletter_opt_in,
          },
          { onConflict: "owner_id" }
        )
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    /* ---------- Addresses ---------- */
    async getAddresses() {
      await requireSession();
      const { data, error } = await cloud.database
        .from("addresses")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async addAddress(address) {
      await requireSession();
      const { data, error } = await cloud.database
        .from("addresses")
        .insert({
          label: address.label || "Home",
          full_name: address.full_name,
          line1: address.line1,
          postal_code: address.postal_code,
          city: address.city,
          country: address.country,
          phone: address.phone || null,
          is_default: !!address.is_default,
        })
        .select();
      if (error) throw error;
      return data?.[0] || null;
    },

    async deleteAddress(id) {
      await requireSession();
      const { data, error } = await cloud.database.from("addresses").delete().eq("id", id).select();
      if (error) throw error;
      return Array.isArray(data) ? data.length : 0;
    },

    /* ---------- Cloud cart ---------- */
    async getCart() {
      await requireSession();
      const { data, error } = await cloud.database.from("carts").select("items").maybeSingle();
      if (error) throw error;
      return data && data.items && typeof data.items === "object" ? data.items : {};
    },

    async saveCart(items) {
      await requireSession();
      const { error } = await cloud.database.from("carts").upsert(
        { items: items, updated_at: new Date().toISOString() },
        { onConflict: "owner_id" }
      );
      if (error) throw error;
    },

    /* ---------- Orders & logistics ---------- */
    async createOrder(order, items) {
      await requireSession();
      const { error: orderError } = await cloud.database.from("orders").insert(order);
      if (orderError) throw orderError;

      const { error: itemsError } = await cloud.database.from("order_items").insert(items);
      if (itemsError) throw itemsError;

      const eta = new Date();
      eta.setDate(eta.getDate() + 4);
      const { error: shipmentError } = await cloud.database.from("shipments").insert({
        order_no: order.order_no,
        status: "preparing",
        estimated_delivery: eta.toISOString().slice(0, 10),
      });
      if (shipmentError) throw shipmentError;
    },

    async markOrderPaid(orderNo, payment) {
      await requireSession();
      const { error } = await cloud.database
        .from("orders")
        .update({
          payment_status: "paid",
          payment_provider: "stripe",
          payment_reference: payment.paymentIntent || payment.sessionId || null,
          paid_at: new Date().toISOString(),
          status: "paid",
        })
        .eq("order_no", orderNo);
      if (error) throw error;
    },

    async getOrders() {
      await requireSession();
      const { data, error } = await cloud.database
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },

    async getOrderItems(orderNos) {
      await requireSession();
      if (!orderNos.length) return [];
      const { data, error } = await cloud.database
        .from("order_items")
        .select("*")
        .in("order_no", orderNos);
      if (error) throw error;
      return data || [];
    },

    async getShipments(orderNos) {
      await requireSession();
      if (!orderNos.length) return [];
      const { data, error } = await cloud.database
        .from("shipments")
        .select("*")
        .in("order_no", orderNos);
      if (error) throw error;
      return data || [];
    },
  };
})();
