import base64
import io
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from quant_scholar_translator.ocr import recognize_image


def png_bytes(width=320, height=180):
    stream = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(stream, format="PNG")
    return stream.getvalue()


class OcrTests(unittest.TestCase):
    def test_returns_sorted_positioned_lines_and_filters_low_confidence(self):
        result = SimpleNamespace(
            boxes=[
                [[20, 80], [200, 80], [200, 105], [20, 105]],
                [[15, 20], [180, 20], [180, 44], [15, 44]],
                [[10, 130], [90, 130], [90, 150], [10, 150]],
            ],
            txts=["second line", "  First   line  ", "noise"],
            scores=[0.91, 0.97, 0.2],
        )
        payload = recognize_image(png_bytes(), engine_factory=lambda: lambda *_args, **_kwargs: result)
        self.assertEqual(payload["width"], 320)
        self.assertEqual([line["text"] for line in payload["lines"]], ["First line", "second line"])
        self.assertEqual(payload["lines"][0]["x"], 15.0)

    def test_rejects_non_image_input_before_loading_model(self):
        with self.assertRaisesRegex(ValueError, "有效图像"):
            recognize_image(b"not an image", engine_factory=lambda: self.fail("must not load OCR"))

    def test_local_endpoint_accepts_a_rendered_page_without_cloud_upload(self):
        from fastapi.testclient import TestClient
        from quant_scholar_translator.realtime import app
        expected={"width":320,"height":180,"lines":[{"text":"GDP","score":.99,"x":1,"y":2,"width":30,"height":10}]}
        encoded=base64.b64encode(png_bytes()).decode("ascii")
        with patch("quant_scholar_translator.ocr.recognize_image", return_value=expected):
            response=TestClient(app).post("/ocr/page",json={"imageBase64":f"data:image/png;base64,{encoded}"})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()["lines"][0]["text"],"GDP")


if __name__ == "__main__":
    unittest.main()
