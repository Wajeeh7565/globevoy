const {
  getRecommendations,
  buildInvalidOriginResponse,
  isInvalidOriginError
} = require('./recommendations');

exports.handler = async function handler(event) {
  try {
    const query = event.queryStringParameters || {};
    const payload = await getRecommendations(query);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*'
      },
      body: JSON.stringify(payload)
    };
  } catch (error) {
    if (isInvalidOriginError(error)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*'
        },
        body: JSON.stringify(buildInvalidOriginResponse())
      };
    }

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*'
      },
      body: JSON.stringify({
        ok: false,
        error: error.message || 'Recommendation request failed'
      })
    };
  }
};
