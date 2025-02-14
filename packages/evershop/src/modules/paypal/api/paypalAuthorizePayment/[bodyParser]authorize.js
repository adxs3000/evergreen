const { select, insert } = require('@evershop/postgres-query-builder');
const { pool } = require('@evershop/evershop/src/lib/postgres/connection');
const {
  INVALID_PAYLOAD,
  OK,
  INTERNAL_SERVER_ERROR
} = require('@evershop/evershop/src/lib/util/httpStatus');
const { error } = require('@evershop/evershop/src/lib/log/logger');
const {
  updatePaymentStatus
} = require('../../../oms/services/updatePaymentStatus');
const { createAxiosInstance } = require('../../services/requester');

// eslint-disable-next-line no-unused-vars
module.exports = async (request, response, delegate, next) => {
  try {
    // eslint-disable-next-line camelcase
    const { order_id } = request.body;
    // Validate the order;
    const order = await select()
      .from('order')
      .where('uuid', '=', order_id)
      .and('payment_method', '=', 'paypal')
      .and('payment_status', '=', 'pending')
      .load(pool);

    if (!order) {
      response.status(INVALID_PAYLOAD);
      response.json({
        error: {
          status: INVALID_PAYLOAD,
          message: 'Invalid order'
        }
      });
    } else {
      // Call API to authorize the paypal order using axios
      const axiosInstance = await createAxiosInstance(request);
      const responseData = await axiosInstance.post(
        `/v2/checkout/orders/${order.integration_order_id}/authorize`
      );

      if (responseData.data.status === 'COMPLETED') {
        // Update payment status
        await updatePaymentStatus(order.order_id, 'authorized');
        // Add transaction data to database
        await insert('payment_transaction')
          .given({
            payment_transaction_order_id: order.order_id,
            transaction_id:
              responseData.data.purchase_units[0].payments.authorizations[0].id,
            amount:
              responseData.data.purchase_units[0].payments.authorizations[0]
                .amount.value,
            currency:
              responseData.data.purchase_units[0].payments.authorizations[0]
                .amount.currency_code,
            status:
              responseData.data.purchase_units[0].payments.authorizations[0]
                .status,
            payment_action: 'authorize',
            transaction_type: 'online',
            additional_information: JSON.stringify(responseData.data)
          })
          .execute(pool);

        // Save order activities
        await insert('order_activity')
          .given({
            order_activity_order_id: order.order_id,
            comment: `Customer authorized the payment using PayPal. Transaction ID: ${responseData.data.purchase_units[0].payments.authorizations[0].id}`,
            customer_notified: 0
          })
          .execute(pool);

        response.status(OK);
        response.json({
          data: {}
        });
      } else {
        response.status(INTERNAL_SERVER_ERROR);
        response.json({
          error: {
            status: INTERNAL_SERVER_ERROR,
            message: responseData.data.message
          }
        });
      }
    }
  } catch (err) {
    error(err);
    response.status(INTERNAL_SERVER_ERROR);
    response.json({
      error: {
        status: INTERNAL_SERVER_ERROR,
        message: err.message
      }
    });
  }
};
