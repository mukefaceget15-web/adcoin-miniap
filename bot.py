import os
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
CHANNELS = ["@NOTREWARR", "@WithdrawNott"]

def check_membership(user_id):
    if not BOT_TOKEN:
        return False

    for channel in CHANNELS:
        try:
            url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChatMember"
            response = requests.get(
                url,
                params={"chat_id": channel, "user_id": user_id},
                timeout=10
            )
            data = response.json()

            if not data.get("ok"):
                return False

            status = data["result"]["status"]
            if status not in ("creator", "administrator", "member"):
                if not (
                    status == "restricted"
                    and data["result"].get("is_member", False)
                ):
                    return False

        except Exception:
            return False

    return True

@app.route("/")
def home():
    return "NOT REWARD bot is running"

@app.route("/check", methods=["POST"])
def check():
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id")

    if not user_id:
        return jsonify({"ok": False, "error": "missing_user_id"}), 400

    return jsonify({"ok": True, "joined": check_membership(user_id)})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
