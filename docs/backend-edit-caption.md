# Backend: let the admin edit a photo's caption

**Where this goes:** your FastAPI backend (the one on Render), not this website folder.

**What it adds:** `PATCH /api/v1/admin/media/{media_id}` with a JSON body
`{ "caption": "...", "alt_text": "..." }`. It changes the caption and/or description of a
photo that is already in the Media library. Send only the fields you want to change; send
`""` or `null` to clear one. It answers with the updated photo (`MediaResponse`), the same
as `GET /api/v1/admin/media/{media_id}`.

Nothing in the database changes: the `media` table already has `caption` and `alt_text`.
The gallery, posts and events read the caption from the photo, so a new caption shows
everywhere that photo is used.

The website's admin already has the **Edit caption** buttons. They start working as soon as
this endpoint is deployed.

---

## 1. Add a schema

In the file that defines `MediaResponse` (often `app/schemas/media.py`):

```python
from pydantic import BaseModel, Field


class MediaUpdate(BaseModel):
    """Fields an admin can change on an uploaded photo. Leave a field out to keep it."""

    caption: str | None = Field(default=None, max_length=500)
    alt_text: str | None = Field(default=None, max_length=500)
```

## 2. Add the endpoint

In the router that already has `GET /admin/media/{media_id}` and
`DELETE /admin/media/{media_id}` (tag **Admin Media**, often `app/api/v1/admin/media.py`).
Use the **same** database session dependency, admin sign-in dependency, `Media` model and
`MediaResponse` as the existing GET in that file. The names below are examples.

**If your routes are normal (`def`) functions with a SQLAlchemy `Session`:**

```python
from uuid import UUID

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.schemas.media import MediaResponse, MediaUpdate  # adjust to your project


@router.patch("/{media_id}", response_model=MediaResponse)
def update_media(
    media_id: UUID,
    data: MediaUpdate,
    db: Session = Depends(get_db),                     # same as your GET route
    current_admin=Depends(get_current_admin),          # same as your GET route
):
    media = db.get(Media, media_id)
    if media is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Media not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None   # "" clears the field
        setattr(media, field, value)

    db.commit()
    db.refresh(media)
    return media   # build the response exactly like your GET route does (e.g. public_url)
```

**If your routes are `async def` with an `AsyncSession`:**

```python
@router.patch("/{media_id}", response_model=MediaResponse)
async def update_media(
    media_id: UUID,
    data: MediaUpdate,
    db: AsyncSession = Depends(get_db),
    current_admin=Depends(get_current_admin),
):
    media = await db.get(Media, media_id)
    if media is None:
        raise HTTPException(status_code=404, detail="Media not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(media, field, value)

    await db.commit()
    await db.refresh(media)
    return media
```

If your GET route builds the response with a helper (for example
`MediaResponse.from_orm_with_url(media)` or `to_media_response(media)`), return the photo
the same way here so `public_url` is filled in.

If the router's path prefix is already `/admin/media`, the path above (`/{media_id}`) is
right. If the router has no prefix, use `@router.patch("/admin/media/{media_id}", ...)`.

## 3. Check CORS allows PATCH

In `main.py` (or wherever `CORSMiddleware` is added), `allow_methods` must include `PATCH`.
`allow_methods=["*"]` already does. The site already uses PATCH for posts and documents,
so this is most likely fine.

## 4. Deploy and test

1. Push the backend change; Render redeploys it.
2. Open `https://orlu-land-community-api.onrender.com/docs`. Under **Admin Media** you
   should now see **PATCH /api/v1/admin/media/{media_id}**.
3. In the website admin, open **Media library**, click a photo, click **Edit caption**,
   type a caption and save. Open the Gallery page: the caption shows under that photo.

## Optional: a test

```python
def test_edit_media_caption(client, admin_headers, uploaded_media_id):
    r = client.patch(
        f"/api/v1/admin/media/{uploaded_media_id}",
        json={"caption": "Royal fathers at the honours night"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["caption"] == "Royal fathers at the honours night"

    r = client.patch(f"/api/v1/admin/media/{uploaded_media_id}", json={"caption": ""}, headers=admin_headers)
    assert r.json()["caption"] is None
```
