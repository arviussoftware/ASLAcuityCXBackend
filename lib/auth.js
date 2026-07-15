import jwt from "jsonwebtoken";

const secretKey = process.env.MSSQLDB_SECRET;

export function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, secretKey, (err, decoded) => {
      if (err) {
        return reject(err);
      }
      resolve(decoded);
    });
  });
}
