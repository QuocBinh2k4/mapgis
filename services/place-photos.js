const express = require("express");
const { randomUUID } = require("node:crypto");
const { Readable } = require("node:stream");
const { ApiError } = require("./auth");

const rawImage = express.raw({ type: "*/*", limit: "4mb" });
const imageTypes = {
  "image/jpeg": {
    extension: "jpg",
    valid: (data) =>
      data.length >= 3 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[2] === 0xff,
  },
  "image/png": {
    extension: "png",
    valid: (data) =>
      data.length >= 8 &&
      data
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/webp": {
    extension: "webp",
    valid: (data) =>
      data.length >= 12 &&
      data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP",
  },
};
const positiveId = (value) => {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    throw new ApiError("Mã địa điểm hoặc ảnh không hợp lệ.");
  return id;
};
function registerPlacePhotos(app, pool, auth) {
  const { api, requireUser } = auth;
  app.post(
    "/api/tourism/:id/photos",
    (req, res, next) =>
      rawImage(req, res, (error) => {
        if (error)
          return res
            .status(error.type === "entity.too.large" ? 413 : 400)
            .json({
              error:
                error.type === "entity.too.large"
                  ? "Ảnh vượt quá giới hạn 4 MB."
                  : "Không đọc được ảnh tải lên.",
            });
        next();
      }),
    api(async (req, res) => {
      const user = await requireUser(req, true),
        placeId = positiveId(req.params.id);
      if (!process.env.BLOB_READ_WRITE_TOKEN)
        throw new ApiError("Blob storage token is not configured.", 503);
      const mime = String(req.headers["content-type"] || "")
          .split(";")[0]
          .trim()
          .toLowerCase(),
        data = req.body,
        type = imageTypes[mime];
      if (!Buffer.isBuffer(data) || !data.length || !type?.valid(data))
        throw new ApiError(
          "Chỉ nhận ảnh JPEG, PNG hoặc WebP hợp lệ, tối đa 4 MB.",
        );
      const caption = String(req.query.caption || "").trim();
      if (caption.length > 500)
        throw new ApiError("Ghi chú ảnh tối đa 500 ký tự.");
      if (
        !(
          await pool.query(
            "SELECT id FROM diem_du_lich WHERE id=$1 AND deleted_at IS NULL",
            [placeId],
          )
        ).rows.length
      )
        throw new ApiError("Không tìm thấy địa điểm.", 404);
      const { put } = await import("@vercel/blob");
      const blob = await put(
        `community/${randomUUID()}.${type.extension}`,
        data,
        {
          access: "public",
          contentType: mime,
          addRandomSuffix: true,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        },
      );
      const photo = (
        await pool.query(
          `INSERT INTO place_photos(tourism_id,user_id,blob_url,mime_type,byte_size,caption)
            VALUES($1,$2,$3,$4,$5,$6) RETURNING id,caption,created_at`,
          [placeId, user.id, blob.url, mime, data.length, caption],
        )
      ).rows[0];
      res
        .status(201)
        .json({ ...photo, image_url: `/api/tourism-photos/${photo.id}/image` });
    }),
  );
  app.get(
    "/api/tourism/:id/photos",
    api(async (req, res) => {
      const user = await requireUser(req),
        placeId = positiveId(req.params.id);
      const admin = user.role === "admin";
      const items = (
        await pool.query(
          `SELECT p.id,p.caption,p.created_at,u.display_name AS uploader
            FROM place_photos p JOIN app_users u ON u.id=p.user_id
            WHERE p.tourism_id=$1 AND ($3::boolean OR p.user_id=$2)
            ORDER BY p.created_at DESC,p.id DESC LIMIT 48`,
          [placeId, user.id, admin],
        )
      ).rows;
      res.json({
        items: items.map((item) => ({
          ...item,
          image_url: `/api/tourism-photos/${item.id}/image`,
        })),
      });
    }),
  );
  app.get(
    "/api/tourism-photos/:id/image",
    api(async (req, res) => {
      const user = await requireUser(req),
        photoId = positiveId(req.params.id),
        admin = user.role === "admin";
      const photo = (
        await pool.query(
          `SELECT blob_url,mime_type FROM place_photos WHERE id=$1 AND ($3::boolean OR user_id=$2)`,
          [photoId, user.id, admin],
        )
      ).rows[0];
      if (!photo)
        return res.status(404).type("text/plain").send("Không tìm thấy ảnh.");
      if (!process.env.BLOB_READ_WRITE_TOKEN)
        throw new ApiError("Blob storage token is not configured.", 503);
      const { get } = await import("@vercel/blob");
      const blob = await get(photo.blob_url, {
        access: "public",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      if (!blob || blob.statusCode !== 200 || !blob.stream)
        return res.status(404).type("text/plain").send("Không tìm thấy ảnh.");
      res.set({
        "Content-Type": photo.mime_type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      Readable.fromWeb(blob.stream)
        .on("error", (error) => res.destroy(error))
        .pipe(res);
    }),
  );
}
module.exports = { registerPlacePhotos };
