// utils/response.util.js
exports.success = (res, message, data = {}, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    statusCode,
    message,
    data,
    error: null
  });
};

exports.fail = (res, message, statusCode = 400, error = null) => {
  return res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    data: null,
    error
  });
};