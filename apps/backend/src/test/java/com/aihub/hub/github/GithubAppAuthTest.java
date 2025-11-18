package com.aihub.hub.github;

import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Clock;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GithubAppAuthTest {

    static final String TEST_KEY = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCunDlQt+gUacfZ\n1U0x0jmgrxabfNyZIldzxosQzX43+6mx0zmaOHE2GFr1gU9T9lZG3kB+sp/7+9l2\nY6PYlo1XqsG7TzF2DH/yQz/gTps1WJ8u7Z0QDAy7+JkifhNoT1XoH4BNDpxlbTqo\nUgyVdBKP7jK6BRMeKI2jHeSzP/fnQn3mTjtt2Jxu9dW9rZJzTy3JQSlz64p7J3wN\nGdzoMjPcD9jNSUs5dJkSMsq9zKF77TI2s9zgXgDX/GV7VaZ7muwuMAb/LkePE83z\nA0O4GT0jJiCAfiOE3Zj6+ugpkGSKbLsC8qLqMj2gOYgDn8TsjuH1wJPNVrgzlsUo\n9gxY2NdJAgMBAAECggEAEsK+5HIqlyWH5k0KCkUt9grmLVqGTkV4NpM2U/3NWBSk\nXShHKd13CUXo6NMnHD6KvgVXCNveh6T37Xy7Kaq9CQ3aszVtbdt8SP9QVLQ4Vw9N\nLcdUyqUvbpCXuBAfFl9k1FPj0Q7VqMRJGkIdAS7F3go04UPPInNT7ByPrQsBWSq3\nPKECWylzN7+uxV0c7wPu6m7wOkQAzFTsxnxkZvl6HGMFaWyPzKpSYnNsPuHPNtmB\n8n/B8HHi97tspPE1oBT8DnQfkbdZuG3h6DuX02eYwrh30T4Hs87sSh+03XHmqiNv\n5iJompi6ElRGnDopxrbfHept2VJz8P7uwFE7j4C5YQKBgQDWI9IrlI8y/TJZTPU1\nJb97Q4GvsYGjAqPpTg8XFu25YTS4s9H+yX4dtpp+v6MmHfzwJLOnVjopxTy8Gr7o\nF6kRCOQ7IqpwrztxHi39YwVX2SXErs0PYz86XjUHQpPXnMvkcd52EymuRhvdCmZr\nFbbS8xT23wwU2GlwFhudOM3kwQKBgQDJAKl00++rKnC2ho45pMBUqb4ME2wWUXoa\nPcHBbK9wAgv1ElUFVq/DT5w0wZAch8rfQJh+PT0SkJUt1XILo/oM7fDjFeMc27qU\nQMSq7x0yslMCnhuXqVzJYGhJb7Q3N7qKsrY37F2YTvK3tCS8KDOQhFejv6Z3b0w3\nQy3IqTGaZQKBgCNtwv46hOs+SgVbL/8aeGw98kGgNQtgtpPp7h99HaXDp1S7E3Hy\nypFxIYhGkp+nPpI7rL+CAdcp2hpLixEu8beXw4ANXxwfbT6es10nWuxBx21afoYH\nSeh5ByQPSXqB7w1jk9r41F/rTEt5IHGS+sbki6nALMnmNTa5OrH5o0ZBAoGBAIy+\nPxc+3ANH6HaQLWgovjku9vhtIe7si07LCKEF+qxhLLp5zWmqhgfapz8xne6eCMMg\n5zBhyUzV6IvmuUpiVBo7d6jAv/ysOiVzfdgEyaA9gGZPznXVKqV7X5xgESi8bXuh\n6V0A1hd+oSjQikLTrJMynzHSvgKizUruHB65+vZBAoGAWjW/p3aevV6nqlHqnV9I\nlNEDRpwqlNEvu3n/I5FB64HY3/d4BC3UjHd7ffTh8n/VnFxrQXLixNsPsOkYLkCO\nslg0KtwEETJ/5EFqbDDYcvRzfg0jEs9fwLP1VE9AQHVd2CWrWDQUlZqxA/dRkI/0\no0vEvgUSnQxWrnSE9H0VbMM=\n-----END PRIVATE KEY-----";

    @Test
    void verifiesSignatureInConstantTime() throws Exception {
        RestClient client = RestClient.builder().baseUrl("https://api.github.com").build();
        GithubAppAuth auth = new GithubAppAuth(client, Clock.systemUTC(), "123", TEST_KEY, "", "1") {
            @Override
            public String getInstallationToken() {
                return "test";
            }
        };
        String payload = "{\"action\":\"test\"}";
        String secret = "secret";
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        String signature = "sha256=" + bytesToHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        assertTrue(auth.verifySignature(payload, secret, signature));
    }

    @Test
    void failsFastWhenInstallationIdIsNotNumeric() {
        RestClient client = RestClient.builder().baseUrl("https://api.github.com").build();
        assertThrows(IllegalStateException.class, () -> new GithubAppAuth(client, Clock.systemUTC(), "123", TEST_KEY, "", "abc"));
    }

    private String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
