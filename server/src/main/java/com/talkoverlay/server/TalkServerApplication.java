package com.talkoverlay.server;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * CiRCLE 服务端启动入口。
 *
 * <p>负责启动 Spring Boot 应用，并开启 {@link com.talkoverlay.server.config.ChatProperties}
 * 这类配置属性的自动扫描。</p>
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class TalkServerApplication {

    /**
     * 启动 HTTP 与 WebSocket 服务。
     *
     * @param args 命令行启动参数
     */
    public static void main(String[] args) {
        SpringApplication.run(TalkServerApplication.class, args);
    }
}
