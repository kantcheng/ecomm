/* Thin client for the server-side payment gateway. No keys live here. */
(function () {
  async function request(url, options) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (_) {
      throw new Error("Payment service is unreachable. Please check your connection.");
    }
    let payload = {};
    try { payload = await response.json(); } catch (_) { /* keep empty */ }
    if (!response.ok) {
      throw new Error((payload.error && payload.error.message) || "Payment request failed. Please try again.");
    }
    return payload;
  }

  window.VOLTARO_PAY = {
    config() {
      return request("/api/pay/config");
    },

    create(orderNo, items, method, email) {
      return request("/api/pay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo, items, method, email }),
      });
    },

    status(sessionId, orderNo) {
      const query = new URLSearchParams({ session_id: sessionId });
      if (orderNo) query.set("order_no", orderNo);
      return request("/api/pay/status?" + query.toString());
    },
  };
})();
