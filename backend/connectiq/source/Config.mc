import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;

// Shared by the foreground app and the background service.
(:background)
module Config {
    const TOKEN_KEY = "token";

    //! Server base URL from the app settings (set in Garmin Connect), without a trailing slash.
    function serverUrl() as String {
        var url = Application.Properties.getValue("serverUrl");
        if (url == null || !(url instanceof String)) {
            return "";
        }
        var s = url as String;
        while (s.length() > 0) {
            var last = s.substring(s.length() - 1, s.length());
            if (last == null || !last.equals("/")) {
                break;
            }
            var trimmed = s.substring(0, s.length() - 1);
            s = trimmed != null ? trimmed : "";
        }
        return s;
    }

    function token() as String? {
        return Application.Storage.getValue(TOKEN_KEY) as String?;
    }

    function deviceModel() as String {
        var part = System.getDeviceSettings().partNumber;
        return part != null ? part : "garmin";
    }

    typedef RequestOptions as {
        :method as Communications.HttpRequestMethod,
        :headers as Dictionary,
        :responseType as Communications.HttpResponseContentType
    };

    function jsonOptions(token as String?) as RequestOptions {
        // ngrok's free plan can answer with an HTML warning page; this header skips it.
        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            "ngrok-skip-browser-warning" => "1"
        };
        if (token != null) {
            headers["Authorization"] = "Bearer " + token;
        }
        return {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
    }
}
